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


async def test_solar_surplus_charging_modulates_amps(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-5000", {"unit_of_measurement": "W"})  # exporting 5 kW
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    set_value = async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    rt = res["car"]["runtime"]
    assert rt["status"] == "solar" and rt["mode"] == "solar"
    # solar start: only the start command, no current limit yet
    assert len(turn_on) == 1 and set_value == [] and rt["amps"] is None

    # the car now draws 6 A (4140 W) at the charger's old limit, so the export shrinks; after the interval
    # the limit follows: 860 + 4140 (own draw) = 5000 W / (230 V * 3) = 7.2 -> 7 A
    hass.states.async_set("sensor.grid", "-860", {"unit_of_measurement": "W"})
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["amps"] == 7 and [c.data["value"] for c in set_value] == [7.0]
    assert len(turn_on) == 1

    # surplus drops below 6 A (4140 W): while charging, the car's own draw (7 A) counts as available
    hass.states.async_set("sensor.grid", "-500", {"unit_of_measurement": "W"})
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    # available = 500 + 7*690 = 5330 W -> still charging at 7 A
    assert rt["status"] == "solar" and rt["amps"] == 7

    # now importing: available = 7*690 - 2000 = 2830 W < 4140 -> stop (solar_min_minutes = 0)
    hass.states.async_set("sensor.grid", "2000", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 5, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_wait"
    assert len(turn_off) == 1


async def test_solar_start_hysteresis(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 2}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "solar_wait"
    assert len(turn_on) == 0
    freezer.tick(timedelta(minutes=3))
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"
    assert len(turn_on) == 1


async def test_battery_first_blocks_ev_solar_until_soc(hass: HomeAssistant, hass_ws_client, freezer) -> None:
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
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "battery", "solar_priority_over": 90, "solar_min_minutes": 0}})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "battery_first"

    hass.states.async_set("sensor.bat_soc", "95")
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    # battery first: only the export counts -> 3000 W / 690 = 4 A < min 6 A -> wait
    assert rt["status"] == "solar_wait"

    # EV first: export + battery charging power = 5000 W -> start now, 7 A after the interval
    await _ws(hass, client, 5, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "ev"}})
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["status"] == "solar" and rt["amps"] is None
    hass.states.async_set("sensor.grid", "1140", {"unit_of_measurement": "W"})  # the car draws 4140 W of the 3000 W export
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 7, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["status"] == "solar" and rt["amps"] == 7  # -1140 + 2000 + 4140


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
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0}})
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


async def test_battery_priority_band_blocks_ev_only_inside_band(hass: HomeAssistant, hass_ws_client) -> None:
    """Battery as no. 1 wins (EV blocked) only while its SoC is inside [under, over]; outside, solar is used normally."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.bat_soc", "40")
    hass.states.async_set("sensor.bat_power", "0", {"unit_of_measurement": "W"})
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc", "power_entity": "sensor.bat_power", "grid_power_entity": "sensor.grid"}})
    rules = await _ws(hass, client, 2, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "battery", "solar_priority_under": 0, "solar_priority_over": 30, "solar_min_minutes": 0}})
    assert rules["rules"]["solar_priority_over"] == 30
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "solar"  # 40 % is above the band -> normal use, EV gets the export
    assert res["car"]["runtime"]["solar_priority"] is None
    assert len(turn_on) == 1

    hass.states.async_set("sensor.bat_soc", "25")  # inside the band -> battery wins
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "battery_first"
    assert len(turn_off) == 1

    # swapped order: EV no. 1 with the car's own SoC (50 %) inside the default band -> EV wins again
    res = await _ws(hass, client, 5, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "ev"}})
    assert res["rules"]["solar_priority_over"] == 30  # band kept, now applies to the car's SoC
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar" and res["cars"][0]["runtime"]["solar_priority"] is None
    res = await _ws(hass, client, 7, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority_over": 80}})
    res = await _ws(hass, client, 8, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["solar_priority"] == "ev"

    # under > over is swapped, not rejected
    res = await _ws(hass, client, 9, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority_under": 90, "solar_priority_over": 20}})
    assert (res["rules"]["solar_priority_under"], res["rules"]["solar_priority_over"]) == (20, 90)


async def test_ev_priority_claims_battery_charging_power_only_inside_band(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.bat_soc", "60")
    hass.states.async_set("sensor.bat_power", "3000", {"unit_of_measurement": "W"})  # battery charging 3 kW
    hass.states.async_set("sensor.grid", "-2000", {"unit_of_measurement": "W"})  # export 2 kW
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc", "power_entity": "sensor.bat_power", "grid_power_entity": "sensor.grid"}})
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "ev", "solar_priority_under": 0, "solar_priority_over": 80, "solar_min_minutes": 0}})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "target_soc": 95}})
    assert res["car"]["runtime"]["status"] == "solar"
    # the car draws 4140 W of the export; after the interval: -2140 + 3000 (battery) + 4140 = 5000 W -> 7 A
    hass.states.async_set("sensor.grid", "2140", {"unit_of_measurement": "W"})
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["status"] == "solar" and rt["amps"] == 7

    # house now imports 3 kW while the car draws 7 A (4830 W): own draw credited -> 1830 W available
    hass.states.async_set("sensor.grid", "3000", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 5, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"  # inside the band the battery's 3 kW is claimed too -> 4830 W

    hass.states.async_set("sensor.car_soc", "85")  # above the band -> normal: battery power no longer claimable
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_wait"


async def test_ev_solar_requires_minimum_production(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    """With solar_min_w set, production must exceed it for solar_min_minutes before starting, and stop after the same window."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    hass.states.async_set("sensor.pv", "1.0", {"unit_of_measurement": "kW"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": PRICE_ENTITY, "solar_power_entity": "sensor.pv"}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    rules = await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_w": "2000", "solar_min_minutes": 2}})
    assert rules["rules"]["solar_min_w"] == 2000
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    rt = res["car"]["runtime"]
    assert rt["status"] == "solar_low" and rt["solar_w"] == 1000
    assert len(turn_on) == 0

    # production above the limit, but not for long enough yet
    hass.states.async_set("sensor.pv", "3.0", {"unit_of_measurement": "kW"})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_low"
    freezer.tick(timedelta(minutes=2, seconds=1))
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_wait"  # production ok, surplus timer starts now
    freezer.tick(timedelta(minutes=2, seconds=1))
    res = await _ws(hass, client, 5, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"
    assert len(turn_on) == 1
    stops_before = len(turn_off)  # the first evaluation sends a stop to sync the charger

    # production drops: keep charging until the window has passed, then stop
    hass.states.async_set("sensor.pv", "500", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"
    freezer.tick(timedelta(minutes=2, seconds=1))
    res = await _ws(hass, client, 7, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_low"
    assert len(turn_off) == stops_before + 1


def test_rules_migrate_from_start_stop_minutes() -> None:
    from custom_components.electricity_optimizer.storage import normalize_rules

    old = {"solar_priority": "ev", "battery_min_soc_for_ev_solar": 90, "solar_start_minutes": 3, "solar_stop_minutes": 5}
    rules = normalize_rules({}, old)
    assert rules["solar_min_minutes"] == 3
    assert (rules["solar_priority_under"], rules["solar_priority_over"]) == (0, 100)
    assert "battery_min_soc_for_ev_solar" not in rules and "solar_start_minutes" not in rules

    # battery first with "EV gets solar above 90 %" -> battery wins while 0-90 %
    old_battery_first = {**old, "solar_priority": "battery"}
    migrated = normalize_rules({}, old_battery_first)
    assert (migrated["solar_priority_under"], migrated["solar_priority_over"]) == (0, 90)


async def test_min_amps_above_max_is_rejected(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/cars/save", "car": {**CAR, "min_amps": 16, "max_amps": 10}})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["message"] == "min_amps_above_max"


async def test_charge_now_resends_button_press(hass: HomeAssistant, hass_ws_client) -> None:
    """Stateless buttons (e.g. Zaptec authorize/deauthorize) are pressed again on every manual action."""
    now = dt_util.now()
    _set_prices(hass, {now.hour: 5.0, now.hour + 1: 5.0})  # expensive now -> the plan waits
    hass.states.async_set("sensor.car_soc", "50")
    press = async_mock_service(hass, "button", "press")
    await _setup(hass)
    client = await hass_ws_client(hass)
    ready_by = (now + timedelta(hours=10)).strftime("%H:%M")  # plenty of cheaper slots before the deadline
    car = {**CAR, "source": "plan", "ready_by": ready_by, "start_entity": "button.authorize", "stop_entity": "button.deauthorize", "current_entity": ""}
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": car})
    cid = res["car"]["id"]
    assert res["car"]["runtime"]["status"] == "waiting"
    assert [c.data["entity_id"] for c in press] == ["button.deauthorize"]  # sync: stop on first run

    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": {"id": cid, "charge_now": True}})
    assert res["car"]["runtime"]["status"] == "charge_now"
    assert [c.data["entity_id"] for c in press] == ["button.deauthorize", "button.authorize"]

    # pressing "Lad nu" again while the controller already thinks it is charging still presses the button
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/cars/save", "car": {"id": cid, "charge_now": False}})
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/cars/save", "car": {"id": cid, "charge_now": True}})
    assert [c.data["entity_id"] for c in press] == ["button.deauthorize", "button.authorize", "button.deauthorize", "button.authorize"]


async def test_command_test_presses_button_and_reports_errors(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    press = async_mock_service(hass, "button", "press")
    hass.states.async_set("button.authorize", "unknown")
    await _setup(hass)
    client = await hass_ws_client(hass)
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/command/test", "entity_id": "button.authorize"})
    assert res == {"ok": True} and [c.data["entity_id"] for c in press] == ["button.authorize"]

    await client.send_json({"id": 2, "type": f"{DOMAIN}/command/test", "entity_id": "button.does_not_exist"})
    msg = await client.receive_json()
    assert not msg["success"] and "findes ikke" in msg["error"]["message"]

    hass.states.async_set("select.mode", "Self-use")
    await client.send_json({"id": 3, "type": f"{DOMAIN}/command/test", "entity_id": "select.mode"})
    msg = await client.receive_json()
    assert not msg["success"] and "value" in msg["error"]["message"]


async def test_charge_now_works_when_smart_charging_is_off_and_above_target(hass: HomeAssistant, hass_ws_client) -> None:
    """'Lad nu' is a manual override: it charges even with Smart opladning off and SoC above the target, and 'Stop' sends stop."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "85")  # above target 80
    press = async_mock_service(hass, "button", "press")
    await _setup(hass)
    client = await hass_ws_client(hass)
    car = {**CAR, "source": "plan", "enabled": False, "start_entity": "button.authorize", "stop_entity": "button.deauthorize", "current_entity": ""}
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": car})
    cid = res["car"]["id"]
    assert res["car"]["runtime"]["status"] == "disabled" and press == []

    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": {"id": cid, "charge_now": True}})
    assert res["car"]["runtime"]["status"] == "charge_now" and res["car"]["runtime"]["charging"] is True
    assert [c.data["entity_id"] for c in press] == ["button.authorize"]

    await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert len(press) == 1  # nothing re-sent while unchanged

    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/cars/save", "car": {"id": cid, "charge_now": False}})
    assert res["car"]["runtime"]["status"] == "disabled" and res["car"]["runtime"]["charging"] is False
    assert [c.data["entity_id"] for c in press] == ["button.authorize", "button.deauthorize"]

    # full -> the manual charge ends by itself and charge_now is cleared
    await _ws(hass, client, 5, {"type": f"{DOMAIN}/cars/save", "car": {"id": cid, "charge_now": True, "enabled": True}})
    hass.states.async_set("sensor.car_soc", "100")
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["charge_now"] is False and res["cars"][0]["runtime"]["status"] == "done"


async def test_surplus_from_solar_minus_house(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    """Kun sol with surplus_source=solar_house: available = solar - house (own draw credited while charging)."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.pv", "6000", {"unit_of_measurement": "W"})
    hass.states.async_set("sensor.house", "1500", {"unit_of_measurement": "W"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    set_value = async_mock_service(hass, "number", "set_value")
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": PRICE_ENTITY, "solar_power_entity": "sensor.pv"}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    rules = await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"surplus_source": "solar_house", "house_power_entity": "sensor.house", "solar_min_minutes": 0}})
    assert rules["rules"]["surplus_source"] == "solar_house" and rules["context"]["surplus_from"] == "solar_house"
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    rt = res["car"]["runtime"]
    # 6000 - 1500 = 4500 W / 690 = 6.5 -> 6 A, sent after the interval (the start goes alone)
    assert rt["status"] == "solar" and rt["surplus_w"] == 4500
    assert len(turn_on) == 1 and set_value == []
    hass.states.async_set("sensor.house", "5640", {"unit_of_measurement": "W"})  # house incl. the car's 4140 W
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["amps"] == 6 and [c.data["value"] for c in set_value] == [6.0]

    # the house sensor now includes the car's draw (6 A = 4140 W); production up -> 8 A
    hass.states.async_set("sensor.house", "5640", {"unit_of_measurement": "W"})
    hass.states.async_set("sensor.pv", "7500", {"unit_of_measurement": "W"})
    freezer.tick(timedelta(seconds=31))  # amps changes in solar mode are rate limited
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    # 7500 - 5640 + 4140 (own draw) = 6000 W -> 8 A (a debounced evaluation may already have credited 8 A)
    assert rt["status"] == "solar" and rt["amps"] == 8 and rt["surplus_w"] >= 6000

    # clouds: 3000 W production, house 5640 incl. car -> 3000 - 5640 + 4140 = 1500 < 4140 -> stop
    hass.states.async_set("sensor.pv", "3000", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 5, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar_wait"
    assert len(turn_off) >= 1

    # house sensor without the car: no own-draw credit
    await _ws(hass, client, 6, {"type": f"{DOMAIN}/rules/save", "rules": {"house_includes_ev": False}})
    hass.states.async_set("sensor.pv", "7000", {"unit_of_measurement": "W"})
    hass.states.async_set("sensor.house", "1500", {"unit_of_measurement": "W"})
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 7, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"  # starts (no limit yet)
    freezer.tick(timedelta(seconds=31))
    res = await _ws(hass, client, 8, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["amps"] == 7  # 5500/690, no own-draw credit added

    # missing house sensor -> falls back to the grid sensor, which is absent here
    await _ws(hass, client, 9, {"type": f"{DOMAIN}/rules/save", "rules": {"house_power_entity": ""}})
    res = await _ws(hass, client, 10, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "no_grid_sensor"


async def test_amps_interval_is_configurable(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-5000", {"unit_of_measurement": "W"})
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    set_value = async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    rules = await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0, "amps_interval_seconds": 120}})
    assert rules["rules"]["amps_interval_seconds"] == 120
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    hass.states.async_set("sensor.grid", "-860", {"unit_of_measurement": "W"})  # the car draws 4140 W
    freezer.tick(timedelta(seconds=60))
    await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert set_value == []  # 60 s < 120 s: still no current limit
    freezer.tick(timedelta(seconds=61))
    await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    assert [c.data["value"] for c in set_value] == [7.0]


async def test_no_power_after_start_is_reported_and_start_resent(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-12000", {"unit_of_measurement": "W"})  # enough for max amps (no current entity)
    hass.states.async_set("sensor.car_power", "0", {"unit_of_measurement": "W"})
    press = async_mock_service(hass, "button", "press")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0}})
    car = {**CAR, "start_entity": "button.authorize", "stop_entity": "button.deauthorize", "current_entity": "", "power_entity": "sensor.car_power"}
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": car})
    assert res["car"]["runtime"]["status"] == "solar"
    assert [c.data["entity_id"] for c in press] == ["button.authorize"]

    freezer.tick(timedelta(seconds=60))
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"  # still within the grace period

    freezer.tick(timedelta(seconds=150))
    res = await _ws(hass, client, 4, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["status"] == "no_power" and rt["charging"] is True
    assert [c.data["entity_id"] for c in press] == ["button.authorize", "button.authorize"]  # start re-sent

    freezer.tick(timedelta(seconds=60))
    await _ws(hass, client, 5, {"type": f"{DOMAIN}/evaluate"})
    assert len(press) == 2  # not more often than every 5 minutes

    hass.states.async_set("sensor.car_power", "4100", {"unit_of_measurement": "W"})  # the car charges now
    res = await _ws(hass, client, 6, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "solar"

    hist = await _ws(hass, client, 7, {"type": f"{DOMAIN}/history/list"})
    assert hist["open"] and hist["open"][0]["solar_kwh"] == 0  # 0 W measured -> no energy counted


async def test_failed_start_is_visible_in_status(hass: HomeAssistant, hass_ws_client) -> None:
    """A start command the charger integration rejects shows as a failed start, not as charging."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    await _setup(hass)  # no button service registered -> press fails
    client = await hass_ws_client(hass)
    car = {**CAR, "source": "plan", "charge_now": True, "start_entity": "button.authorize", "stop_entity": "button.deauthorize", "current_entity": ""}
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": car})
    rt = res["car"]["runtime"]
    assert rt["status"] == "cmd_failed" and rt["charging"] is False
    assert rt["last_action"]["ok"] is False and rt["last_action"]["action"] == "start"
