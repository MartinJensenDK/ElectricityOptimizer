"""The last measured SoC is kept for display while the sensor has no value, also across a restart."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_mock_service

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.const import DOMAIN

PRICE_ENTITY = "sensor.energi_data_service"


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    day = dt_util.now().replace(hour=0, minute=0, second=0, microsecond=0)
    raw_today = [{"hour": day + timedelta(hours=h), "price": 1.5} for h in range(24)]
    hass.states.async_set(PRICE_ENTITY, "1.5", {"raw_today": raw_today, "tomorrow_valid": False})
    for domain, service in (("switch", "turn_on"), ("switch", "turn_off")):
        async_mock_service(hass, domain, service)
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": PRICE_ENTITY}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _evaluate(client, msg_id: int) -> dict:
    await client.send_json({"id": msg_id, "type": f"{DOMAIN}/evaluate"})
    msg = await client.receive_json()
    assert msg["success"], msg
    return msg["result"]


async def test_car_keeps_last_measured_soc(hass: HomeAssistant, hass_ws_client) -> None:
    hass.states.async_set("sensor.car_soc", "55", {"unit_of_measurement": "%"})
    hass.states.async_set("switch.charger", "off")
    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    car = {"name": "Tesla", "soc_entity": "sensor.car_soc", "start_entity": "switch.charger", "stop_entity": "switch.charger", "source": "plan"}
    await client.send_json({"id": 1, "type": f"{DOMAIN}/cars/save", "car": car})
    msg = await client.receive_json()
    assert msg["success"], msg
    car_id = msg["result"]["car"]["id"]
    rt = msg["result"]["car"]["runtime"]
    assert rt["soc"] == 55 and rt["last_soc"] == 55

    # the sensor drops out: nothing is planned from the old value, but it is still there to show
    hass.states.async_set("sensor.car_soc", "unavailable")
    rt = (await _evaluate(client, 2))["cars"][0]["runtime"]
    assert rt["soc"] is None and rt["status"] == "no_soc" and rt["plan"] is None
    assert rt["last_soc"] == 55

    # ... also after a restart (the entry is reloaded with the sensor still unavailable)
    await hass.data[DOMAIN]["runtime_state"].async_save()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    rt = (await _evaluate(client, 3))["cars"][0]["runtime"]
    assert rt["soc"] is None and rt["last_soc"] == 55

    # a new measurement replaces it
    hass.states.async_set("sensor.car_soc", "61")
    rt = (await _evaluate(client, 4))["cars"][0]["runtime"]
    assert rt["soc"] == 61 and rt["last_soc"] == 61

    # another sensor: the old sensor's value is not shown for it
    await client.send_json({"id": 5, "type": f"{DOMAIN}/cars/save", "car": {"id": car_id, "soc_entity": "sensor.other_soc"}})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["car"]["runtime"]["last_soc"] is None


async def test_battery_keeps_last_measured_soc(hass: HomeAssistant, hass_ws_client) -> None:
    hass.states.async_set("sensor.bat_soc", "64", {"unit_of_measurement": "%"})
    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc"}})
    msg = await client.receive_json()
    assert msg["success"], msg
    assert msg["result"]["runtime"]["soc"] == 64 and msg["result"]["runtime"]["last_soc"] == 64

    hass.states.async_set("sensor.bat_soc", "unknown")
    rt = (await _evaluate(client, 2))["runtime"]
    assert rt["soc"] is None and rt["status"] == "no_soc" and rt["last_soc"] == 64

    await hass.data[DOMAIN]["runtime_state"].async_save()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    rt = (await _evaluate(client, 3))["runtime"]
    assert rt["soc"] is None and rt["last_soc"] == 64

    await client.send_json({"id": 4, "type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.other_soc"}})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["runtime"]["last_soc"] is None
