"""A Home Assistant restart must not interrupt what is running: sensors without a value yet are waited for."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_mock_service

from homeassistant.core import CoreState, HomeAssistant

from custom_components.electricity_optimizer.const import DOMAIN, STARTUP_HOLD_SECONDS

from test_rules import CAR, PRICE_ENTITY, _set_prices, _setup, _ws


async def _charging_car_then_restart(hass: HomeAssistant, hass_ws_client):
    """A car charging from solar; then Home Assistant "restarts" and the other integrations' sensors are not ready."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/rules/save", "rules": {"grid_power_entity": "sensor.grid", "solar_min_minutes": 0, "solar_stop_minutes": 0}})
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    assert res["car"]["runtime"]["status"] == "solar" and len(turn_on) == 1

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    hass.states.async_remove(PRICE_ENTITY)
    hass.states.async_remove("sensor.grid")
    hass.states.async_set("sensor.car_soc", "unavailable")
    hass.set_state(CoreState.not_running)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    hass.set_state(CoreState.running)
    return await hass_ws_client(hass), turn_on, turn_off


async def test_restart_waits_for_sensors_instead_of_stopping(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    client, turn_on, turn_off = await _charging_car_then_restart(hass, hass_ws_client)

    # sensors still missing a minute later: nothing is decided, nothing is sent
    freezer.tick(timedelta(seconds=60))
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["charging"]
    assert len(turn_on) == 1 and len(turn_off) == 0

    # the sensors come back one by one: still nothing until the last one is there
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "55")
    await _ws(hass, client, 2, {"type": f"{DOMAIN}/evaluate"})
    assert len(turn_on) == 1 and len(turn_off) == 0
    hass.states.async_set("sensor.grid", "-6000", {"unit_of_measurement": "W"})
    res = await _ws(hass, client, 3, {"type": f"{DOMAIN}/evaluate"})
    rt = res["cars"][0]["runtime"]
    assert rt["charging"] and rt["status"] == "solar"
    assert len(turn_on) == 1 and len(turn_off) == 0  # the charge simply went on


async def test_restart_hold_gives_up_after_a_while(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    """A sensor that never comes back must not block the optimizer for ever."""
    client, turn_on, turn_off = await _charging_car_then_restart(hass, hass_ws_client)
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "55")  # the grid sensor stays away

    freezer.tick(timedelta(seconds=STARTUP_HOLD_SECONDS - 10))
    await _ws(hass, client, 1, {"type": f"{DOMAIN}/evaluate"})
    assert len(turn_off) == 0

    freezer.tick(timedelta(seconds=20))
    res = await _ws(hass, client, 2, {"type": f"{DOMAIN}/evaluate"})
    assert res["cars"][0]["runtime"]["status"] == "no_grid_sensor"
    assert len(turn_off) == 1  # decided without the sensor, as before


async def test_reload_while_running_does_not_wait(hass: HomeAssistant, hass_ws_client) -> None:
    """Reloading the integration in a running Home Assistant evaluates at once."""
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    entry = await _setup(hass)
    assert hass.data[DOMAIN]["optimizer"]._startup_hold_until is None
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN]["optimizer"]._startup_hold_until is None


async def test_passed_hour_in_the_heatmap_survives_a_restart(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    _set_prices(hass)
    hass.states.async_set("sensor.car_soc", "50")
    async_mock_service(hass, "switch", "turn_on")
    async_mock_service(hass, "switch", "turn_off")
    async_mock_service(hass, "number", "set_value")
    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    res = await _ws(hass, client, 1, {"type": f"{DOMAIN}/cars/save", "car": CAR})
    first = res["car"]["runtime"]["recent"]
    assert len(first) == 1

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    freezer.tick(timedelta(hours=1))
    _set_prices(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    await hass.data[DOMAIN]["optimizer"].async_evaluate()
    recent = next(iter(hass.data[DOMAIN]["ev"]["controller"].runtime.values()))["recent"]
    assert [e["start"] for e in recent][0] == first[0]["start"] and len(recent) == 2
