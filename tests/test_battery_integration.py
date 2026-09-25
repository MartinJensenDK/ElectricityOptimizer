"""Battery websocket + command tests against Home Assistant."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_mock_service

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.const import DOMAIN

PRICE_ENTITY = "sensor.energi_data_service"


def _set_prices(hass: HomeAssistant, prices: dict[int, float], default: float = 1.5) -> None:
    now = dt_util.now()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    raw_today = [{"hour": day + timedelta(hours=h), "price": prices.get(h, default)} for h in range(24)]
    raw_tomorrow = [{"hour": day + timedelta(days=1, hours=h), "price": prices.get(24 + h, default)} for h in range(24)]
    hass.states.async_set(
        PRICE_ENTITY,
        str(raw_today[now.hour]["price"]),
        {"raw_today": raw_today, "raw_tomorrow": raw_tomorrow, "tomorrow_valid": True},
    )


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": PRICE_ENTITY}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_battery_select_commands(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    # cheap now, expensive in a few hours -> hold
    _set_prices(hass, {now.hour: 0.5, now.hour + 3: 3.0})
    hass.states.async_set("sensor.bat_soc", "60", {"unit_of_measurement": "%"})
    select = async_mock_service(hass, "select", "select_option")
    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": f"{DOMAIN}/battery/get"})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["battery"] is None

    await client.send_json({"id": 2, "type": f"{DOMAIN}/battery/save", "battery": {"capacity_kwh": 10}})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["message"] == "soc_required"

    await client.send_json(
        {
            "id": 3,
            "type": f"{DOMAIN}/battery/save",
            "battery": {
                "soc_entity": "sensor.bat_soc",
                "capacity_kwh": "10",
                "max_charge_kw": "5",
                "max_discharge_kw": "5",
                "hold_start_entity": "select.inverter_mode",
                "hold_start_value": "Hold",
                "hold_stop_entity": "select.inverter_mode",
                "hold_stop_value": "Self-use",
                "charge_start_entity": "select.inverter_mode",
                "charge_start_value": "Charge",
                "charge_stop_entity": "select.inverter_mode",
                "charge_stop_value": "Self-use",
            },
        }
    )
    msg = await client.receive_json()
    assert msg["success"], msg
    assert msg["result"]["runtime"]["mode"] == "hold"
    # first run: the other mode (charge) is stopped, then Hold selected
    assert [c.data["option"] for c in select] == ["Self-use", "Hold"]

    # manual override to charge
    await client.send_json({"id": 4, "type": f"{DOMAIN}/battery/save", "battery": {"override": "charge"}})
    msg = await client.receive_json()
    assert msg["result"]["runtime"]["mode"] == "charge" and msg["result"]["runtime"]["status"] == "override"
    assert [c.data["option"] for c in select][-2:] == ["Self-use", "Charge"]

    # back to auto -> hold again
    await client.send_json({"id": 5, "type": f"{DOMAIN}/battery/save", "battery": {"override": "auto"}})
    msg = await client.receive_json()
    assert msg["result"]["runtime"]["mode"] == "hold"
    assert [c.data["option"] for c in select][-2:] == ["Self-use", "Hold"]

    await client.send_json({"id": 6, "type": f"{DOMAIN}/battery/delete"})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["battery"] is None


async def test_battery_readonly_without_commands(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour: 0.5, now.hour + 3: 3.0})
    hass.states.async_set("sensor.bat_soc", "60", {"unit_of_measurement": "%"})
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc"}})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["runtime"]["mode"] == "hold"
    assert msg["result"]["runtime"]["commands_configured"] == {"charge": False, "hold": False}
    assert msg["result"]["runtime"]["last_action"]["sent"] == []


async def test_ev_select_and_number_commands(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour: 0.2}, default=2.0)
    hass.states.async_set("sensor.car_soc", "50", {"unit_of_measurement": "%"})
    set_value = async_mock_service(hass, "number", "set_value")
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/cars/save",
            "car": {
                "name": "Kia",
                "soc_entity": "sensor.car_soc",
                "start_entity": "number.charger_current",
                "start_value": "16",
                "stop_entity": "number.charger_current",
                "stop_value": "0",
                "ready_by": (now + timedelta(hours=2)).strftime("%H:%M"),
            },
        }
    )
    msg = await client.receive_json()
    assert msg["success"], msg
    assert msg["result"]["car"]["runtime"]["status"] == "charging"
    assert [c.data["value"] for c in set_value] == [16.0]
    hass.states.async_set("sensor.car_soc", "80", {"unit_of_measurement": "%"})
    await client.send_json({"id": 2, "type": f"{DOMAIN}/evaluate"})
    await client.receive_json()
    assert [c.data["value"] for c in set_value] == [16.0, 0.0]


async def test_forecast_entities_reach_the_battery_plan(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    _set_prices(hass, {now.hour: 0.3, (now.hour + 4) % 48: 3.0})
    hass.states.async_set("sensor.bat_soc", "50")
    hass.states.async_set("sensor.fc_today", "28.5", {"unit_of_measurement": "kWh"})
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"price_entity": PRICE_ENTITY, "solar_forecast_today_entity": "sensor.fc_today"},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc", "grid_charge_enabled": True, "grid_charge_max_forecast_kwh": "20"}})
    msg = await client.receive_json()
    assert msg["success"], msg
    fc = msg["result"]["runtime"]["plan"]["forecast"]
    assert fc["today"] == 28.5 and fc["limit"] == 20.0 and fc["blocked_today"] is True
    assert msg["result"]["runtime"]["mode"] == "hold"
