"""Solar surplus charging, priorities and EV/battery interplay."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_mock_service

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.const import DOMAIN

PRICE_ENTITY = "sensor.energi_data_service"


def _set_prices(hass: HomeAssistant, prices: dict[int, float] | None = None, default: float = 1.5) -> None:
    prices = prices or {}
    now = dt_util.now()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    raw_today = [{"hour": day + timedelta(hours=h), "price": prices.get(h, default)} for h in range(24)]
    raw_tomorrow = [{"hour": day + timedelta(days=1, hours=h), "price": prices.get(24 + h, default)} for h in range(24)]
    hass.states.async_set(PRICE_ENTITY, "1.5", {"raw_today": raw_today, "raw_tomorrow": raw_tomorrow, "tomorrow_valid": True})


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": PRICE_ENTITY}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _ws(hass, client, msg_id, payload):
    await client.send_json({"id": msg_id, **payload})
    msg = await client.receive_json()
    assert msg["success"], msg
    return msg["result"]


CAR = {
    "name": "Tesla",
    "soc_entity": "sensor.car_soc",
    "start_entity": "switch.charger",
    "stop_entity": "switch.charger",
    "current_entity": "number.charger_current",
    "min_amps": 6,
    "max_amps": 16,
    "phases": 3,
    "source": "solar",
    "ready_by": "07:00",
}


async def test_solar_surplus_charging_modulates_amps(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-5000", {"unit_of_measurement": "W"})  # exporting 5 kW
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    set_value = async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_start_minutes": 0, "solar_stop_minutes": 0}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    rt = res["car"]["runtime"]
    assert rt["status"] == "solar" and rt["mode"] == "solar"
    # 5000 W / (230 V * 3) = 7.2 -> 7 A
    assert rt["amps"] == 7
    assert [c.data["value"] for c in set_value] == [7.0]
    assert len(turn_on) == 1

    # surplus drops below 6 A (4140 W): while charging, the car's own draw (7 A) counts as available
    hass.states.async_set("sensor.grid", "-500", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    # available = 500 + 7*690 = 5330 W -> still charging at 7 A
    assert rt["status"] == "solar" and rt["amps"] == 7

    # now importing: available = 7*690 - 2000 = 2830 W < 4140 -> stop (stop_minutes = 0)
    hass.states.async_set("sensor.grid", "2000", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_wait"
    assert len(turn_off) == 1


async def test_solar_start_hysteresis(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_start_minutes": 2}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "solar_wait"
    assert len(turn_on) == 0
    freezer.tick(timedelta(minutes=3))
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"
    assert len(turn_on) == 1


async def test_battery_first_blocks_ev_solar_until_soc(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.bat_soc", "70")
    hass.states.async_set("sensor.bat_power", "2000", {"unit_of_measurement": "W"})  # battery charging 2 kW
    hass.states.async_set("sensor.grid", "-3000", {"unit_of_measurement": "W"})
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc", "power_entity": "sensor.bat_power", "grid_power_entity": "sensor.grid"}})
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "battery", "battery_min_soc_for_ev_solar": 90, "solar_start_minutes": 0}})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "battery_first"

    hass.states.async_set("sensor.bat_soc", "95")
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    # battery first: only the export counts -> 3000 W / 690 = 4 A < min 6 A -> wait
    assert rt["status"] == "solar_wait"

    # EV first: export + battery charging power = 5000 W -> 7 A
    await _ws(hass, client, 5, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "ev"}})
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["status"] == "solar" and rt["amps"] == 7


async def test_battery_holds_while_ev_charges_from_grid(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass)  # flat prices -> battery auto mode is normal
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.bat_soc", "60")
    async_mock_service(hass, "switch", "turn_on")
    select = async_mock_service(hass, "select", "select_option")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/battery/save", "battery": {
        "soc_entity": "sensor.bat_soc",
        "hold_start_entity": "select.mode", "hold_start_value": "Hold",
        "hold_stop_entity": "select.mode", "hold_stop_value": "Self-use",
    }})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan", "charge_now": True}})
    assert res["car"]["runtime"]["status"] == "charge_now"
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/battery/get"})
    assert res["runtime"]["mode"] == "hold" and res["runtime"]["status"] == "ev_hold"
    assert [c.data["option"] for c in select][-1] == "Hold"

    await _ws(hass, client, 4, {"type": f"{DOMAIN}/rules/save", "rules": {"hold_battery_while_ev_grid_charging": False}})
    res = await _ws(hass, client, 5, {"type": f"{DOMAIN}/battery/get"})
    assert res["runtime"]["mode"] == "normal"


async def test_main_fuse_limits_ev_when_battery_has_grid_priority(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour: 0.2, (now.hour + 5) % 48: 3.0})
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.bat_soc", "20")
    async_mock_service(hass, "switch", "turn_on")
    set_value = async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc", "grid_charge_enabled": True, "max_charge_kw": 6.9}})  # 10 A
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_priority": "battery", "max_total_amps": 20}})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan", "ready_by": (now + timedelta(hours=2)).strftime("%H:%M")}})
    rt = res["car"]["runtime"]
    bat = await _ws(hass, client, 4, {"type": f"{DOMAIN}/battery/get"})
    assert bat["runtime"]["mode"] == "charge"
    # 20 A fuse - 10 A battery = 10 A left for the car
    assert rt["status"] == "charging" and rt["amps"] == 10
    assert [c.data["value"] for c in set_value] == [10.0]


async def test_cars_move_changes_priority_order(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    await _setup(hass)
    client = await hass_ws_client(hass)
    a = (await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "name": "A"}}))["car"]
    b = (await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "name": "B"}}))["car"]
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/move", "car_id": b["id"], "direction": "up"})
    assert [c["name"] for c in res["cars"]] == ["B", "A"]
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/cars/move", "car_id": b["id"], "direction": "up"})
    assert [c["name"] for c in res["cars"]] == ["B", "A"]
    assert a["id"] != b["id"]


async def test_today_source_controls_grid_and_solar(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour: 0.2})  # cheap now
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_start_minutes": 0}})
    today = now.weekday()
    schedule = [{"enabled": True, "source": "plan", "ready_by": (now + timedelta(hours=2)).strftime("%H:%M"), "target_soc": 80} for _ in range(7)]
    schedule[today]["source"] = "solar"  # today: solar only, even though the hour is cheap
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan", "schedule": schedule}})
    rt = res["car"]["runtime"]
    assert rt["source_today"] == "solar" and rt["status"] == "solar" and rt["mode"] == "solar"
    schedule[today]["source"] = "plan"
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": {"id": res["car"]["id"], "schedule": schedule}})
    assert res["car"]["runtime"]["status"] == "charging" and res["car"]["runtime"]["mode"] == "grid"
    assert len(turn_on) >= 1
