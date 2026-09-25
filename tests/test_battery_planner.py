"""Tests for the battery planning logic."""

from datetime import datetime, timedelta

from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.battery_controller import plan_battery
from custom_components.electricity_optimizer.const import BATTERY_DEFAULTS
from custom_components.electricity_optimizer.ev_controller import Slot

TZ = dt_util.get_time_zone("Europe/Copenhagen")


def _slots(day: datetime, prices: list[float]) -> list[Slot]:
    return [Slot(day + timedelta(hours=i), day + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]


def _cfg(**overrides):
    cfg = {**BATTERY_DEFAULTS, "capacity_kwh": 10.0, "max_charge_kw": 5.0, "spread_threshold": 0.5, "efficiency": 0.9}
    cfg.update(overrides)
    return cfg


def test_hold_when_cheap_now_and_expensive_later():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.0] * 24
    prices[14] = 0.5  # cheap afternoon
    prices[18] = 2.5  # expensive evening
    plan = plan_battery(day + timedelta(hours=14, minutes=10), _slots(day, prices), soc=60, cfg=_cfg())
    assert plan["auto_mode"] == "hold"
    modes = {datetime.fromisoformat(p["start"]).hour: p["mode"] for p in plan["plan"]}
    assert modes[18] == "normal"  # discharge in the expensive hour
    assert modes[23] == "normal"  # nothing dearer afterwards


def test_no_hold_when_price_above_mean():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.0] * 24
    prices[18] = 2.5
    plan = plan_battery(day + timedelta(hours=15), _slots(day, prices), soc=60, cfg=_cfg())
    # 1.0 is below the mean (1.06) but only 1.5 dearer... hold applies; make price above mean instead
    prices[15] = 1.2
    plan = plan_battery(day + timedelta(hours=15), _slots(day, prices), soc=60, cfg=_cfg())
    assert plan["auto_mode"] == "normal"


def test_charge_from_grid_in_cheapest_slots_when_spread_is_large():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.5] * 24
    prices[2] = 0.3
    prices[3] = 0.4
    prices[18] = 3.0
    prices[19] = 3.0
    cfg = _cfg(grid_charge_enabled=True, capacity_kwh=10, max_charge_kw=5)  # 50% room -> 1 h
    plan = plan_battery(day + timedelta(hours=2), _slots(day, prices), soc=50, cfg=cfg)
    modes = {datetime.fromisoformat(p["start"]).hour: p["mode"] for p in plan["plan"]}
    assert plan["auto_mode"] == "charge"
    assert modes[2] == "charge"
    assert modes[3] == "hold"  # cheap but not needed for charging -> hold for the evening
    assert plan["charge_hours"] == 1.0


def test_no_grid_charge_when_disabled_or_full():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.5] * 24
    prices[2] = 0.3
    prices[18] = 3.0
    slots = _slots(day, prices)
    plan = plan_battery(day + timedelta(hours=2), slots, soc=50, cfg=_cfg(grid_charge_enabled=False))
    assert plan["auto_mode"] == "hold"
    plan = plan_battery(day + timedelta(hours=2), slots, soc=100, cfg=_cfg(grid_charge_enabled=True))
    assert plan["auto_mode"] == "hold"


def test_no_charge_when_spread_too_small():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.0] * 24
    prices[2] = 0.8
    slots = _slots(day, prices)
    plan = plan_battery(day + timedelta(hours=2), slots, soc=50, cfg=_cfg(grid_charge_enabled=True))
    assert all(p["mode"] == "normal" for p in plan["plan"])


def test_returns_none_without_future_slots():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    assert plan_battery(day + timedelta(days=2), _slots(day, [1.0] * 24), soc=50, cfg=_cfg()) is None
