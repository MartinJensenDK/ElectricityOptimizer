"""Average price of stored energy, the battery's efficiency and the discharge price rule."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from custom_components.electricity_optimizer.const import BATTERY_DEFAULTS, CAR_DEFAULTS, RULES_DEFAULTS
from custom_components.electricity_optimizer.cost import CostTracker
from custom_components.electricity_optimizer.ev_controller import Slot
from custom_components.electricity_optimizer.storage import normalize_battery, normalize_rules

T0 = datetime(2026, 11, 19, 10, 0, tzinfo=timezone.utc)
BAT = {**BATTERY_DEFAULTS, "soc_entity": "sensor.soc", "capacity_kwh": 10.0}
CAR = {**CAR_DEFAULTS, "id": "c1", "name": "Bil", "capacity_kwh": 60.0, "max_amps": 16, "phases": 3}


def _ctx(minute, *, price=2.0, soc=None, battery_w=None, grid_w=None, solar_value=0.0):
    now = T0 + timedelta(minutes=minute)
    return SimpleNamespace(
        now=now,
        slots=[Slot(T0, T0 + timedelta(hours=24), price)],
        rules={**RULES_DEFAULTS, "solar_value_per_kwh": solar_value},
        battery_soc=soc,
        battery_w=battery_w,
        grid_w=grid_w,
    )


def _run(tracker, steps, cars=(), car_rt=None, bat=BAT, **fixed):
    for i, step in enumerate(steps):
        tracker.update(_ctx(i, **{**fixed, **step}), list(cars), car_rt or {}, bat, {"mode": step.get("mode", "normal")} if False else {"mode": "normal"})


def test_grid_charging_sets_the_average_to_the_grid_price():
    t = CostTracker()
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], battery_w=3000, grid_w=3500, price=2.0)
    assert t.average("battery") == pytest.approx(2.0)
    assert t.snapshot("battery")["solar_share"] == pytest.approx(0.0)


def test_solar_charging_counts_as_the_solar_value():
    t = CostTracker()
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], battery_w=3000, grid_w=-500, price=2.0)
    assert t.average("battery") == pytest.approx(0.0)
    assert t.snapshot("battery")["solar_share"] == pytest.approx(1.0)
    t = CostTracker()
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], battery_w=3000, grid_w=-500, price=2.0, solar_value=0.4)
    assert t.average("battery") == pytest.approx(0.4)


def test_mixed_charging_blends_grid_and_sun():
    t = CostTracker()
    # 3 kW into the battery while 1.5 kW is bought: half grid, half sun
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], battery_w=3000, grid_w=1500, price=2.0)
    assert t.average("battery") == pytest.approx(1.0)
    assert t.snapshot("battery")["solar_share"] == pytest.approx(0.5)


def test_new_energy_is_blended_with_what_is_already_stored():
    t = CostTracker()
    _run(t, [{"soc": 0}, {"soc": 0}, {"soc": 50}], battery_w=3000, grid_w=4000, price=1.0)
    assert t.average("battery") == pytest.approx(1.0)
    # another 5 kWh at 3.00 on top of 5 kWh at 1.00
    for i, soc in enumerate((50, 100)):
        t.update(_ctx(10 + i, price=3.0, soc=soc, battery_w=3000, grid_w=4000), [], {}, BAT, {"mode": "normal"})
    assert t.average("battery") == pytest.approx(2.0)


def test_discharging_keeps_the_average():
    t = CostTracker()
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], battery_w=3000, grid_w=3500, price=2.0)
    for i, soc in enumerate((55, 40, 20)):
        t.update(_ctx(10 + i, price=5.0, soc=soc, battery_w=-2000, grid_w=0), [], {}, BAT, {"mode": "normal"})
    assert t.average("battery") == pytest.approx(2.0)


def test_car_charged_from_the_grid_and_from_the_house_battery():
    t = CostTracker()
    t.data["pools"] = {"battery": {"avg": 1.0, "last_soc": 80}}
    rt = {"c1": {"charging": True, "car_w": 11000, "soc": 40, "mode": "grid"}}
    # 11 kW into the car: 5.5 kW from the grid at 3.00, 5.5 kW from the house battery at 1.00
    for i, soc in enumerate((40, 40, 45)):
        rt["c1"]["soc"] = soc
        t.update(_ctx(i, price=3.0, soc=80, battery_w=-5500, grid_w=5500), [CAR], rt, BAT, {"mode": "normal"})
    assert t.average("ev:c1") == pytest.approx(2.0)
    assert t.snapshot("ev:c1")["solar_share"] == pytest.approx(0.0)


def test_car_charged_away_from_home_keeps_its_average():
    t = CostTracker()
    t.data["pools"] = {"ev:c1": {"avg": 1.5, "last_soc": 30}}
    t.update(_ctx(0, soc=None), [CAR], {"c1": {"charging": False, "soc": 80}}, None, {})
    assert t.average("ev:c1") == pytest.approx(1.5)


def test_removed_car_and_battery_are_forgotten():
    t = CostTracker()
    t.data["pools"] = {"ev:gone": {"avg": 1.5}, "battery": {"avg": 1.0}}
    t.update(_ctx(0), [], {}, None, {})
    assert t.data["pools"] == {}


def test_efficiency_from_power_and_soc():
    t = CostTracker()
    # 60 minutes at 5 kW in = 5 kWh, SoC +45 % of 10 kWh = 4.5 kWh stored -> 90 %
    for i in range(61):
        t.update(_ctx(i, soc=10 + 45 * i / 60, battery_w=5000, grid_w=6000), [], {}, BAT, {"mode": "charge"})
    # 54 minutes at 4 kW out = 3.6 kWh, SoC −40 % = 4 kWh drawn -> 90 %
    for i in range(1, 55):
        t.update(_ctx(60 + i, soc=55 - 40 * i / 54, battery_w=-4000, grid_w=0), [], {}, BAT, {"mode": "normal"})
    eff = t.efficiency_snapshot()
    assert eff["charge"] == pytest.approx(0.9, abs=0.01)
    assert eff["discharge"] == pytest.approx(0.9, abs=0.01)
    assert eff["round_trip"] == pytest.approx(0.81, abs=0.02)


def test_efficiency_prefers_energy_sensors_and_survives_their_midnight_reset():
    t = CostTracker()
    readings = [(10, 0.0), (20, 4.0), (30, 8.0), (30, 0.0), (40, 4.0)]  # (SoC, kWh charged today); the sensor resets
    for i, (soc, kwh) in enumerate(readings):
        t.update(_ctx(i, soc=soc, battery_w=None), [], {}, BAT, {"mode": "charge"}, charged_kwh=kwh, discharged_kwh=0.0)
    eff = t.efficiency_snapshot()
    assert eff["in_kwh"] == pytest.approx(12.0)
    assert eff["stored_kwh"] == pytest.approx(3.0)
    assert eff["discharge"] is None  # nothing discharged yet


def test_efficiency_not_shown_before_enough_is_measured():
    t = CostTracker()
    for i in range(3):
        t.update(_ctx(i, soc=50 + i, battery_w=3000, grid_w=4000), [], {}, BAT, {"mode": "charge"})
    assert t.efficiency_snapshot()["charge"] is None


def test_settings_are_normalised():
    assert normalize_battery({"discharge_min_margin": "0,25"})["discharge_min_margin"] == 0.25
    assert normalize_battery({"discharge_min_margin": ""})["discharge_min_margin"] is None
    assert normalize_battery({})["discharge_min_margin"] is None
    assert normalize_rules({"solar_value_per_kwh": "0,4"}, {})["solar_value_per_kwh"] == 0.4
    assert normalize_rules({}, {})["solar_value_per_kwh"] == 0.0


async def test_battery_is_held_while_the_price_is_too_close_to_its_average(hass, hass_ws_client) -> None:
    from pytest_homeassistant_custom_component.common import async_mock_service

    from custom_components.electricity_optimizer.const import DOMAIN
    from test_battery_integration import _set_prices, _setup

    _set_prices(hass, {}, default=1.5)
    hass.states.async_set("sensor.bat_soc", "60", {"unit_of_measurement": "%"})
    select = async_mock_service(hass, "select", "select_option")
    await _setup(hass)
    client = await hass_ws_client(hass)
    optimizer = hass.data[DOMAIN]["optimizer"]
    optimizer.cost.data["pools"] = {"battery": {"avg": 1.2, "last_soc": 60}}

    async def save(msg_id, battery):
        await client.send_json({"id": msg_id, "type": f"{DOMAIN}/battery/save", "battery": battery})
        msg = await client.receive_json()
        assert msg["success"], msg
        return msg["result"]["runtime"]

    base = {
        "soc_entity": "sensor.bat_soc",
        "capacity_kwh": "10",
        "hold_start_entity": "select.inverter_mode",
        "hold_start_value": "Hold",
        "hold_stop_entity": "select.inverter_mode",
        "hold_stop_value": "Self-use",
    }
    # no limit chosen: the battery discharges as always
    rt = await save(1, base)
    assert rt["mode"] == "normal"
    assert rt["cost"]["avg"] == 1.2
    # price 1.50 is less than 1.20 + 0.50 -> held
    rt = await save(2, {"discharge_min_margin": "0,5"})
    assert rt["mode"] == "hold" and rt["status"] == "price_hold"
    assert rt["price_hold"] == {"price": 1.5, "avg": 1.2, "limit": 1.7}
    assert select[-1].data["option"] == "Hold"
    # price 1.50 is at least 1.20 + 0.20 -> discharges again
    rt = await save(3, {"discharge_min_margin": "0.2"})
    assert rt["mode"] == "normal" and rt["status"] == "auto"
    assert select[-1].data["option"] == "Self-use"
    # the average can be started over; without one the rule does nothing
    await client.send_json({"id": 4, "type": f"{DOMAIN}/battery/reset_measurement", "what": "cost"})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["runtime"]["cost"] is None
    rt = await save(5, {"discharge_min_margin": "5"})
    assert rt["mode"] == "normal"


def test_battery_why_text() -> None:
    """The command log gets the numbers a grid-charging decision was made on."""
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace

    from custom_components.electricity_optimizer.battery_controller import BatteryController, plan_battery
    from custom_components.electricity_optimizer.const import BATTERY_DEFAULTS
    from custom_components.electricity_optimizer.ev_controller import Slot

    now = datetime(2026, 11, 20, 0, 5, tzinfo=timezone.utc)
    start = now.replace(minute=0)
    prices = [0.5, 0.6, 3.0, 3.2]
    slots = [Slot(start + timedelta(hours=i), start + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]
    cfg = {**BATTERY_DEFAULTS, "capacity_kwh": 10.0, "max_charge_kw": 5.0, "max_soc": 100, "spread_threshold": 0.5, "efficiency": 0.9, "schedule": None, "grid_charge_enabled": True}
    plan = plan_battery(now, slots, 50, cfg)
    assert plan["auto_mode"] == "charge" and plan["now"]["rule"] == "spread"
    ctx = SimpleNamespace(battery_soc=50.0)
    text = BatteryController._why(ctx, cfg, plan, "charge")
    assert "prisforskel 2,38 kr" in text and "SoC 50 %" in text and "priser kendt til 20.11. kl. 04:00" in text
    cfg["spread_threshold"] = 5.0
    plan = plan_battery(now, slots, 50, cfg)
    assert plan["auto_mode"] == "normal"
    assert "er under 5,00" in BatteryController._why(ctx, cfg, plan, "normal")


def test_car_charging_efficiency() -> None:
    """Energy from the charger against the rise in SoC; a charge somewhere else is left out."""
    from datetime import datetime, timezone

    from custom_components.electricity_optimizer.cost import CostTracker

    tracker = CostTracker({})
    pool = tracker._pool("ev:a")
    now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
    for _ in range(12):  # 12 hours at 1 kW delivered, 0.9 kWh stored per hour
        tracker._car_efficiency(pool, now, 1000.0, 1.0, 0.0)
        tracker._car_efficiency(pool, now, 1000.0, 0.0, 0.9)
    snap = tracker.car_efficiency_snapshot("ev:a")
    assert snap["measurable"] and snap["in_kwh"] == 12.0 and snap["charge"] == 0.9
    tracker._car_efficiency(pool, now, 1000.0, 0.5, 0.0)  # 0.5 kWh pending, then 20 kWh from a public charger
    tracker._car_efficiency(pool, now, 0.0, 0.0, 20.0)
    tracker._car_efficiency(pool, now, 0.0, 0.0, 5.0)  # and a rise with nothing delivered at all
    assert tracker.car_efficiency_snapshot("ev:a")["charge"] == 0.9
    tracker._car_efficiency(pool, now, None, 0.0, 0.0)
    assert not tracker.car_efficiency_snapshot("ev:a")["measurable"]
    tracker.reset_car_efficiency("ev:a")
    assert tracker.car_efficiency_snapshot("ev:a")["in_kwh"] == 0.0 and "avg" in pool


def test_average_starts_over_when_the_battery_is_empty():
    t = CostTracker()
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], battery_w=3000, grid_w=3500, price=2.0)
    assert t.average("battery") == pytest.approx(2.0)
    _run(t, [{"soc": 30}, {"soc": 11}], battery_w=-2000, grid_w=0, price=2.0)
    assert t.average("battery") == pytest.approx(2.0)  # still above 10 %
    _run(t, [{"soc": 10}], battery_w=-2000, grid_w=0, price=2.0)
    assert t.average("battery") is None and t.snapshot("battery") is None
    # the next charge sets the price alone: no trace of the old 2.00
    _run(t, [{"soc": 10}, {"soc": 10}, {"soc": 20}], battery_w=3000, grid_w=3500, price=0.5)
    assert t.average("battery") == pytest.approx(0.5)
    # a reserve above 10 % is the empty point instead
    t = CostTracker()
    bat = {**BAT, "min_soc": 20}
    _run(t, [{"soc": 50}, {"soc": 50}, {"soc": 60}], bat=bat, battery_w=3000, grid_w=3500, price=2.0)
    _run(t, [{"soc": 20}], bat=bat, battery_w=-2000, grid_w=0, price=2.0)
    assert t.average("battery") is None


def _gctx(when, price=2.0, grid_w=None):
    return SimpleNamespace(now=when, slots=[Slot(T0 - timedelta(days=40), T0 + timedelta(days=40), price)], grid_w=grid_w)


def test_grid_money_from_energy_sensors_with_day_and_month_rollover():
    t = CostTracker()
    t.update_grid(_gctx(T0), 5.0, 1.0, 0.6)  # first reading: nothing counted
    t.update_grid(_gctx(T0 + timedelta(minutes=1), price=2.0), 6.0, 1.0, 0.6)  # bought 1 kWh at 2,00
    t.update_grid(_gctx(T0 + timedelta(minutes=2), price=3.0), 6.0, 3.0, 0.5)  # sold 2 kWh at 0,50
    snap = t.grid_snapshot()
    assert snap["today"]["imp_kwh"] == 1.0 and snap["today"]["imp_kr"] == 2.0
    assert snap["today"]["exp_kwh"] == 2.0 and snap["today"]["exp_kr"] == 1.0
    assert snap["month"] == snap["today"]
    # midnight: the sensors reset and the day starts over, the month keeps counting
    next_day = T0.replace(hour=0, minute=0) + timedelta(days=1)
    t.update_grid(_gctx(next_day), 0.0, 0.0, 0.5)
    t.update_grid(_gctx(next_day + timedelta(minutes=1)), 2.0, 0.0, 0.5)
    snap = t.grid_snapshot()
    assert snap["today"]["imp_kwh"] == 2.0 and snap["yesterday"]["imp_kwh"] == 1.0
    assert snap["month"]["imp_kwh"] == 3.0 and snap["month"]["imp_kr"] == 6.0


def test_grid_money_from_power_and_without_sell_price():
    t = CostTracker()
    t.update_grid(_gctx(T0, grid_w=-1200), None, None, None)
    t.update_grid(_gctx(T0 + timedelta(minutes=1), grid_w=-1200), None, None, None)  # 1,2 kW sold for a minute
    t.update_grid(_gctx(T0 + timedelta(minutes=2), price=1.5, grid_w=600), None, None, None)  # 0,6 kW bought
    snap = t.grid_snapshot()["today"]
    assert snap["exp_kwh"] == pytest.approx(0.02) and snap["exp_unpriced_kwh"] == pytest.approx(0.02) and snap["exp_kr"] == 0
    assert snap["imp_kwh"] == pytest.approx(0.01) and snap["imp_kr"] == pytest.approx(0.015)


def test_sell_price_settings_are_normalised():
    rules = normalize_rules({"export_price_fixed": "0,62", "export_price_entity": " sensor.salg "})
    assert rules["export_price_fixed"] == 0.62 and rules["export_price_entity"] == "sensor.salg"
    assert normalize_rules({"export_price_fixed": ""})["export_price_fixed"] is None
