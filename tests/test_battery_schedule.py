"""Battery weekly schedule: day off, per-day grid charging, target SoC by deadline."""

from datetime import datetime, timedelta

from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.battery_controller import next_battery_deadline, plan_battery
from custom_components.electricity_optimizer.ev_controller import Slot
from custom_components.electricity_optimizer.storage import normalize_battery

TZ = dt_util.get_time_zone("Europe/Copenhagen")
FRIDAY = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)  # a Friday


def _slots(prices):
    return [Slot(FRIDAY + timedelta(hours=i), FRIDAY + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]


def _week(**overrides):
    week = [{"enabled": True, "grid_charge": True, "ready_by": "17:00", "target_soc": None} for _ in range(7)]
    for day, entry in overrides.items():
        week[int(day[1:])].update(entry)
    return week


def _cfg(schedule, **kw):
    return normalize_battery({"soc_entity": "sensor.s", "capacity_kwh": 10, "max_charge_kw": 5, "spread_threshold": 0.5, "schedule": schedule, **kw})


def test_schedule_defaults_from_grid_flag():
    cfg = normalize_battery({"soc_entity": "sensor.s", "grid_charge_enabled": True})
    assert len(cfg["schedule"]) == 7 and all(d["grid_charge"] for d in cfg["schedule"])
    cfg = normalize_battery({"soc_entity": "sensor.s", "grid_charge_enabled": False})
    assert not any(d["grid_charge"] for d in cfg["schedule"]) and cfg["grid_charge_enabled"] is False
    cfg = normalize_battery({"soc_entity": "sensor.s", "schedule": _week(d0={"grid_charge": True})})
    assert cfg["grid_charge_enabled"] is True


def test_day_off_gives_normal_all_day():
    prices = [1.0] * 24
    prices[2] = 0.2
    prices[18] = 3.0
    cfg = _cfg(_week(d4={"enabled": False}))  # Friday off
    plan = plan_battery(FRIDAY + timedelta(hours=2), _slots(prices), soc=50, cfg=cfg)
    assert plan["day_enabled"] is False and plan["auto_mode"] == "normal"
    assert all(p["mode"] == "normal" for p in plan["plan"])


def test_grid_charge_disabled_for_the_day_keeps_hold():
    prices = [1.0] * 24
    prices[2] = 0.2
    prices[18] = 3.0
    cfg = _cfg(_week(d4={"grid_charge": False}))
    plan = plan_battery(FRIDAY + timedelta(hours=2), _slots(prices), soc=50, cfg=cfg)
    assert plan["auto_mode"] == "hold"  # cheap now, expensive later, but no grid charging on Fridays


def test_target_soc_before_deadline_picks_cheapest_slots():
    prices = [1.0] * 24  # flat -> spread rule never charges
    prices[3] = 0.9
    prices[5] = 0.8
    cfg = _cfg(_week(d4={"ready_by": "08:00", "target_soc": 100}))  # Friday: full by 08:00
    plan = plan_battery(FRIDAY + timedelta(hours=1), _slots(prices), soc=50, cfg=cfg)  # 5 kWh -> 1 h
    modes = {datetime.fromisoformat(p["start"]).hour: p["mode"] for p in plan["plan"]}
    assert plan["deadline"] == (FRIDAY + timedelta(hours=8)).isoformat() and plan["target_soc"] == 100
    assert modes[5] == "charge" and modes[3] != "charge"
    assert plan["target_hours"] == 1.0


def test_next_battery_deadline_skips_days_without_target_or_grid():
    cfg = _cfg(_week(d5={"target_soc": 80, "grid_charge": False}, d6={"target_soc": 90, "ready_by": "06:00"}))
    deadline, target = next_battery_deadline(FRIDAY + timedelta(hours=20), cfg)
    assert deadline == datetime(2026, 9, 27, 6, 0, tzinfo=TZ) and target == 90
