"""Config flow (required/optional, demo choice) and the demo mode itself."""

import json
from pathlib import Path

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_mock_service

from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.electricity_optimizer import demo
from custom_components.electricity_optimizer.const import DOMAIN

ROOT = Path(__file__).resolve().parent.parent / "custom_components" / "electricity_optimizer"


def test_translations_mark_required_and_optional_fields():
    for name, required, optional, label in (
        ("translations/da.json", "Påkrævet.", "Valgfri.", "Elpris-sensor - EnergiDataService anbefales"),
        ("translations/en.json", "Required.", "Optional.", "Electricity price sensor - EnergiDataService recommended"),
        ("strings.json", "Required.", "Optional.", "Electricity price sensor - EnergiDataService recommended"),
    ):
        text = json.loads((ROOT / name).read_text(encoding="utf-8"))
        steps = {**text["config"]["step"], "init": text["options"]["step"]["init"]}
        assert steps["sensors"]["data"]["price_entity"] == label
        assert steps["init"]["data"]["price_entity"] == label
        assert set(steps["user"]["menu_options"]) == {"sensors", "demo"}
        for step in ("sensors", "solar", "init"):
            data, help_ = steps[step]["data"], steps[step]["data_description"]
            assert set(data) == set(help_)
            for key in data:
                assert help_[key].startswith(required if key == "price_entity" else optional), (name, step, key)
                assert ("(" in data[key].split(")")[-2] if key != "price_entity" else True)
            assert all(data[k].endswith(("(valgfri)", "(optional)")) for k in data if k != "price_entity")


async def test_flow_with_own_sensors(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.energi_data_service", "1.0", {"raw_today": [], "tomorrow_valid": False})
    hass.states.async_set("sensor.other", "1.0")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.MENU and result["menu_options"] == ["sensors", "demo"]
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "sensors"})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "sensors"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"price_entity": "sensor.other"})
    assert result["errors"] == {"price_entity": "not_energidataservice"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"price_entity": "sensor.energi_data_service"})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "solar"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {"price_entity": "sensor.energi_data_service"}
    await hass.async_block_till_done()
    assert "demo" not in hass.data[DOMAIN]
    assert "demo" not in hass.data["frontend_panels"]["electricity-optimizer"].config


async def test_flow_with_demo_data(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    turn_on = async_mock_service(hass, "switch", "turn_on")
    select = async_mock_service(hass, "select", "select_option")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "demo"})
    assert result["type"] is FlowResultType.CREATE_ENTRY and result["title"] == "Electricity Optimizer (demo)"
    entry = result["result"]
    await hass.async_block_till_done()

    # simulated sensors exist, and the panel knows it is a demo
    price = hass.states.get(demo.PRICE)
    assert len(price.attributes["raw_today"]) == 24 and len(price.attributes["raw_tomorrow"]) == 24 and price.attributes["tomorrow_valid"]
    assert hass.states.get(demo.BATTERY_SOC) and hass.states.get(demo.CAR_SOC) and hass.states.get(demo.SOLAR_POWER)
    panel = hass.data["frontend_panels"]["electricity-optimizer"].config
    assert panel["demo"] is True and panel["price_entity"] == demo.PRICE and panel["solar_peak_kw"] == 6.5

    # one car and a battery are there, planned from the demo prices
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/evaluate"})
    msg = await client.receive_json()
    assert msg["success"], msg
    cars = msg["result"]["cars"]
    assert [c["name"] for c in cars] == ["Demo-bil"] and cars[0]["runtime"]["plan"]["plan"]
    assert msg["result"]["battery"]["soc_entity"] == demo.BATTERY_SOC and msg["result"]["runtime"]["plan"]["plan"]

    # "Lad nu": the command goes to the simulator, never to a real service
    await client.send_json({"id": 2, "type": f"{DOMAIN}/cars/save", "car": {"id": cars[0]["id"], "charge_now": True}})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["car"]["runtime"]["charging"] is True
    assert hass.states.get(demo.CHARGER).state == "on" and float(hass.states.get(demo.CAR_POWER).state) > 0
    await client.send_json({"id": 3, "type": f"{DOMAIN}/battery/save", "battery": {"override": "charge"}})
    msg = await client.receive_json()
    assert msg["success"] and hass.states.get(demo.INVERTER_MODE).state == "Charge"
    assert turn_on == [] and select == []

    # demo data is kept apart from the real storage
    await client.send_json({"id": 4, "type": f"{DOMAIN}/rules/save", "rules": {"solar_priority": "battery"}})
    assert (await client.receive_json())["success"]
    assert f"{DOMAIN}.cars.demo" in hass_storage and f"{DOMAIN}.rules.demo" in hass_storage
    assert f"{DOMAIN}.cars" not in hass_storage and f"{DOMAIN}.rules" not in hass_storage and f"{DOMAIN}.battery" not in hass_storage

    # removing the service removes the simulated sensors again
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert not [e for e in hass.states.async_entity_ids() if demo.DemoSimulator.owns(e)]


async def test_real_setup_is_not_affected_by_demo_storage(hass: HomeAssistant, hass_storage) -> None:
    hass_storage[f"{DOMAIN}.cars.demo"] = {"version": 1, "key": f"{DOMAIN}.cars.demo", "data": {"cars": [dict(demo.DEMO_CAR)]}}
    hass.states.async_set("sensor.energi_data_service", "1.0", {"raw_today": [], "tomorrow_valid": False})
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": "sensor.energi_data_service"}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN]["ev"]["store"].cars == []
    assert hass.states.get(demo.PRICE) is None


def test_simulation_moves_with_commands(hass: HomeAssistant) -> None:
    from datetime import datetime, timedelta

    from homeassistant.util import dt as dt_util

    sim = demo.DemoSimulator(hass)
    noon = datetime(2026, 6, 1, 12, 0, tzinfo=dt_util.get_time_zone("Europe/Copenhagen"))
    sim.update(noon)
    assert float(hass.states.get(demo.SOLAR_POWER).state) > 3000
    assert float(hass.states.get(demo.BATTERY_POWER).state) > 0  # surplus charges the battery
    start_bat, start_car = sim.battery_soc, sim.car_soc
    sim.handle_command("switch.turn_on", {"entity_id": demo.CHARGER})
    sim.handle_command("number.set_value", {"entity_id": demo.CHARGER_CURRENT, "value": 10})
    sim.update(noon + timedelta(minutes=10))
    assert float(hass.states.get(demo.CAR_POWER).state) == 10 * 230 * 3
    assert sim.car_soc > start_car and sim.battery_soc < start_bat  # the car draws more than the sun gives: the battery helps
    sim.handle_command("select.select_option", {"entity_id": demo.INVERTER_MODE, "option": "Charge"})
    assert float(hass.states.get(demo.BATTERY_POWER).state) == 5000
    assert float(hass.states.get(demo.GRID_POWER).state) > 0  # now buying from the grid
