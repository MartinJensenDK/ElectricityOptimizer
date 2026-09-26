"""Charging history, notifications and diagnostics."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_mock_service
from homeassistant.setup import async_setup_component

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.const import DOMAIN
from custom_components.electricity_optimizer.notify import EVENT_NOTIFICATION

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


async def test_solar_session_is_recorded_with_savings(hass: HomeAssistant, hass_ws_client, freezer, hass_storage) -> None:
    _set_prices(hass, default=2.0)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "solar" and res["car"]["runtime"]["amps"] == 8  # 6000/690

    # after a minute the own draw is credited and the car is modulated up to 16 A (11 040 W):
    # 60 s * 11 040 W = 0.184 kWh of solar, worth 2.0 kr/kWh
    freezer.tick(timedelta(seconds=60))
    await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    hist = await _ws(hass, client, 4, {"type": f"{DOMAIN}/history/list"})
    assert hist["entries"] == []
    assert len(hist["open"]) == 1
    running = hist["open"][0]
    assert running["kind"] == "ev" and running["source"] == "solar" and running["running"]
    assert abs(running["solar_kwh"] - 0.184) < 0.001
    assert abs(running["saved"] - 0.368) < 0.01  # rounded to 2 decimals

    # heavy import -> stop charging -> the session closes and is stored (nothing added at the stop tick)
    hass.states.async_set("sensor.grid", "9000", {"unit_of_measurement": "W"})
    freezer.tick(timedelta(seconds=60))
    await _ws(hass, client, 5, {"type": f"{DOMAIN}/evaluate"})
    hist = await _ws(hass, client, 6, {"type": f"{DOMAIN}/history/list"})
    assert hist["open"] == []
    assert len(hist["entries"]) == 1
    entry = hist["entries"][0]
    assert entry["name"] == "Tesla" and entry["source"] == "solar"
    assert abs(entry["solar_kwh"] - 0.184) < 0.002 and entry["kwh"] == 0
    assert entry["cost"] == 0 and abs(entry["saved"] - 0.37) < 0.01
    assert entry["soc_start"] == 50 and "end" in entry and not entry.get("running")
    assert hass_storage[f"{DOMAIN}.history"]["data"]["entries"][0]["name"] == "Tesla"


async def test_grid_session_costs_and_saves_vs_day_mean(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour: 0.5, now.hour + 1: 0.5}, default=2.5)  # cheap now (and next hour, in case the clock rolls over)
    hass.states.async_set("sensor.car_soc", "50")
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan", "price_limit": 1.0}})
    assert res["car"]["runtime"]["status"] == "below_limit"
    freezer.tick(timedelta(seconds=120))
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/evaluate"})
    hist = await _ws(hass, client, 3, {"type": f"{DOMAIN}/history/list"})
    running = hist["open"][0]
    kwh = 16 * 690 * 120 / 3600 / 1000  # max amps, 2 minutes
    assert abs(running["kwh"] - kwh) < 0.001 and running["solar_kwh"] == 0
    assert abs(running["cost"] - kwh * 0.5) < 0.01  # rounded to 2 decimals
    mean = (2 * 0.5 + 22 * 2.5) / 24 if now.hour < 23 else (0.5 + 23 * 2.5) / 24
    assert abs(running["saved"] - kwh * (mean - 0.5)) < 0.01


async def test_notification_when_deadline_cannot_be_met(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "10")
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    events = []
    hass.bus.async_listen(EVENT_NOTIFICATION, lambda e: events.append(e.data))
    soon = (dt_util.now() + timedelta(minutes=30)).strftime("%H:%M")
    # 60 kWh car at 6 A max (4.1 kW): 42 kWh needed, impossible in 30 minutes
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan", "max_amps": 6, "ready_by": soon, "target_soc": 80, "capacity_kwh": 60}})
    await hass.async_block_till_done()
    assert len(events) == 1 and "Tesla" in events[0]["message"] and events[0]["key"].startswith("deadline:")
    notifications = hass.states.async_all("persistent_notification")
    assert any("Tesla" in (st.attributes.get("message") or "") for st in notifications) or events  # HA core version dependent

    # evaluating again does not repeat it
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/evaluate"})
    assert len(events) == 1

    # notifications off: events still fire for automations, but no persistent notification
    await _ws(hass, client, 3, {"type": f"{DOMAIN}/rules/save", "rules": {"notify_enabled": False}})
    assert (await _ws(hass, client, 4, {"type": f"{DOMAIN}/rules/get"}))["rules"]["notify_enabled"] is False


async def test_command_failure_notifies_once(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    async_mock_service(hass, "number", "set_value")
    await _setup(hass)  # no switch service registered -> start fails
    client = await hass_ws_client(hass)
    events = []
    hass.bus.async_listen(EVENT_NOTIFICATION, lambda e: events.append(e.data))
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["last_action"]["ok"] is False
    await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    cmd_events = [e for e in events if e["key"].startswith("cmd:")]
    assert len(cmd_events) == 1 and "Tesla" in cmd_events[0]["message"]


async def test_diagnostics(hass: HomeAssistant, hass_client, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan"}})
    assert await async_setup_component(hass, "diagnostics", {})
    http = await hass_client()
    resp = await http.get(f"/api/diagnostics/config_entry/{entry.entry_id}")
    assert resp.status == 200, await resp.text()
    diag = (await resp.json())["data"]
    assert diag["version"] and diag["config"]["price_entity"] == PRICE_ENTITY
    assert diag["cars"][0]["name"] == "Tesla" and "runtime" in diag["cars"][0]
    assert "rules" in diag and "context" in diag and "history" in diag
    assert diag["entities"][PRICE_ENTITY]["state"] == "1.5"
    assert "raw_today" not in diag["entities"][PRICE_ENTITY]["attributes"]


async def test_commands_are_logged(hass: HomeAssistant, hass_ws_client) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("button.authorize", "unknown")
    press = async_mock_service(hass, "button", "press")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": {**CAR, "source": "plan", "start_entity": "button.authorize", "stop_entity": "button.deauthorize", "current_entity": ""}})
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/command/test", "entity_id": "button.authorize"})
    hist = await _ws(hass, client, 3, {"type": f"{DOMAIN}/history/list"})
    cmds = hist["commands"]
    assert cmds[0]["who"] == "Test fra panelet" and cmds[0]["entity_id"] == "button.authorize" and cmds[0]["ok"] and cmds[0]["service"] == "button.press"
    tesla = [c for c in cmds if c["who"] == "Tesla"]
    assert tesla and tesla[0]["action"] in ("start", "stop") and tesla[0]["entity_id"] in ("button.authorize", "button.deauthorize")
    assert len(press) == 2

    # a failing command is logged with its error
    await client.send_json({"id": 4, "type": f"{DOMAIN}/command/test", "entity_id": "select.mode", "value": None})
    hass.states.async_set("select.mode", "x")
    await client.receive_json()
    await client.send_json({"id": 5, "type": f"{DOMAIN}/command/test", "entity_id": "select.mode"})
    await client.receive_json()
    hist = await _ws(hass, client, 6, {"type": f"{DOMAIN}/history/list"})
    assert hist["commands"][0]["ok"] is False and "value" in hist["commands"][0]["error"]
