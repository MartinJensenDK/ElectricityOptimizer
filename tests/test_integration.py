"""Integration tests: setup, panel, websocket and charging commands."""

from datetime import timedelta
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.const import DOMAIN

PRICE_ENTITY = "sensor.energi_data_service"


def test_old_cars_get_amps_from_kw() -> None:
    from custom_components.electricity_optimizer.storage import normalize_car

    car = normalize_car({"name": "Old", "charge_power_kw": 7.4, "phases": 1})
    assert car["max_amps"] == 32
    assert car["min_amps"] == 6
    assert car["charge_power_kw"] == 7.36
    car = normalize_car({"name": "v0.5", "charge_amps": 10, "phases": 3})
    assert car["max_amps"] == 10 and car["charge_power_kw"] == 6.9


def _set_prices(hass: HomeAssistant, cheap_hours: set[int]) -> None:
    now = dt_util.now()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    raw_today = [
        {"hour": day + timedelta(hours=h), "price": 0.2 if h in cheap_hours else 2.0} for h in range(24)
    ]
    hass.states.async_set(
        PRICE_ENTITY,
        str(raw_today[now.hour]["price"]),
        {"raw_today": raw_today, "tomorrow_valid": False, "currency": "DKK", "unit": "kWh"},
    )


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": PRICE_ENTITY}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_registers_panel(hass: HomeAssistant) -> None:
    _set_prices(hass, set())
    await _setup(hass)
    panels = hass.data["frontend_panels"]
    assert "electricity-optimizer" in panels
    assert panels["electricity-optimizer"].sidebar_title == "Electricity Optimizer"
    # versioned path, no query string (proxies that ignore query strings must not serve stale scripts)
    module_url = panels["electricity-optimizer"].config["_panel_custom"]["module_url"]
    version = panels["electricity-optimizer"].config["version"]
    assert module_url == f"/electricity_optimizer_static/{version}/electricity-optimizer-panel.js"
    assert "?" not in module_url


async def test_websocket_cars_and_charging(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour})  # current hour is cheap
    hass.states.async_set("sensor.car_soc", "50", {"unit_of_measurement": "%"})
    hass.states.async_set("switch.charger", "off")
    turn_on = async_mock_service(hass, "switch", "turn_on")
    turn_off = async_mock_service(hass, "switch", "turn_off")
    set_value = async_mock_service(hass, "number", "set_value")

    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": f"{DOMAIN}/cars/list"})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["cars"] == []

    # missing fields are rejected
    await client.send_json({"id": 2, "type": f"{DOMAIN}/cars/save", "car": {"name": "X"}})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["message"] == "soc_required"

    await client.send_json(
        {
            "id": 3,
            "type": f"{DOMAIN}/cars/save",
            "car": {
                "name": "Tesla",
                "soc_entity": "sensor.car_soc",
                "start_entity": "switch.charger",
                "stop_entity": "switch.charger",
                "capacity_kwh": "75",
                "max_amps": "16",
                "phases": "3",
                "current_entity": "number.charger_current",
                "target_soc": 80,
                "ready_by": (now + timedelta(hours=3)).strftime("%H:%M"),
            },
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    car = msg["result"]["car"]
    assert car["capacity_kwh"] == 75.0
    assert car["charge_power_kw"] == 11.04  # 16 A * 230 V * 3
    assert car["runtime"]["status"] == "charging"
    assert car["runtime"]["plan"]["in_plan_now"] is True
    assert len(turn_on) == 1 and turn_on[0].data["entity_id"] == "switch.charger"
    assert len(turn_off) == 0
    # current limit pushed to the charger when charging starts
    assert [(c.data["entity_id"], c.data["value"]) for c in set_value] == [("number.charger_current", 16.0)]

    # changing the amps while charging re-sends the limit and recomputes kW
    await client.send_json({"id": 35, "type": f"{DOMAIN}/cars/save", "car": {"id": car["id"], "max_amps": 10}})
    msg = await client.receive_json()
    assert msg["result"]["car"]["charge_power_kw"] == 6.9
    assert [c.data["value"] for c in set_value] == [16.0, 10.0]

    # reaching the target sends stop (turn_off on the same switch)
    hass.states.async_set("sensor.car_soc", "80", {"unit_of_measurement": "%"})
    await client.send_json({"id": 40, "type": f"{DOMAIN}/evaluate"})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["cars"][0]["runtime"]["status"] == "done"
    assert len(turn_off) == 1

    # partial update via save keeps the rest of the car
    await client.send_json({"id": 50, "type": f"{DOMAIN}/cars/save", "car": {"id": car["id"], "target_soc": 90}})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["car"]["name"] == "Tesla" and msg["result"]["car"]["target_soc"] == 90

    await client.send_json({"id": 60, "type": f"{DOMAIN}/cars/delete", "car_id": car["id"]})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["deleted"] is True


async def test_buttons_used_for_start_and_stop(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, set())  # nothing cheap -> but "charge_now" forces start
    hass.states.async_set("sensor.car_soc", "50", {"unit_of_measurement": "%"})
    press = async_mock_service(hass, "button", "press")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/cars/save",
            "car": {
                "name": "Kia",
                "soc_entity": "sensor.car_soc",
                "start_entity": "button.start",
                "stop_entity": "button.stop",
                "charge_now": True,
            },
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["car"]["runtime"]["status"] == "charge_now"
    assert [c.data["entity_id"] for c in press] == ["button.start"]

    hass.states.async_set("sensor.car_soc", "80", {"unit_of_measurement": "%"})
    await client.send_json({"id": 2, "type": f"{DOMAIN}/evaluate"})
    msg = await client.receive_json()
    assert [c.data["entity_id"] for c in press] == ["button.start", "button.stop"]
    assert msg["result"]["cars"][0]["charge_now"] is False


async def test_options_flow_updates_panel_config(hass: HomeAssistant) -> None:
    _set_prices(hass, set())
    hass.states.async_set("sensor.pv_power", "1200", {"unit_of_measurement": "W", "device_class": "power"})
    entry = await _setup(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] == "form"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={"price_entity": PRICE_ENTITY, "solar_power_entity": "sensor.pv_power", "solar_peak_kw": 6.4},
    )
    assert result["type"] == "create_entry"
    await hass.async_block_till_done()
    panel = hass.data["frontend_panels"]["electricity-optimizer"]
    assert panel.config["solar_power_entity"] == "sensor.pv_power"
    assert panel.config["solar_peak_kw"] == 6.4
