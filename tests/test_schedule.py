"""Weekly schedule: next deadline and per-day targets."""

from datetime import datetime, timedelta

from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.ev_controller import Slot, next_deadline, plan_car
from custom_components.electricity_optimizer.storage import normalize_car

TZ = dt_util.get_time_zone("Europe/Copenhagen")
FRIDAY = datetime(2026, 9, 25, 20, 0, tzinfo=TZ)  # 2026-09-25 is a Friday


def _car(schedule):
    return normalize_car({
        "name": "X",
        "soc_entity": "sensor.s",
        "start_entity": "switch.c",
        "stop_entity": "switch.c",
        "capacity_kwh": 60,
        "max_amps": 16,
        "phases": 3,
        "ready_by": "07:00",
        "target_soc": 80,
        "schedule": schedule,
    })


def _week(**overrides):
    week = [{"enabled": True, "ready_by": "07:00", "target_soc": 80} for _ in range(7)]
    for day, entry in overrides.items():
        week[int(day[1:])].update(entry)
    return week


def test_schedule_defaults_from_car_fields():
    car = normalize_car({"name": "X", "ready_by": "06:30", "target_soc": 90})
    assert len(car["schedule"]) == 7
    assert all(e == {"enabled": True, "source": "solar_plan", "ready_by": "06:30", "target_soc": 90} for e in car["schedule"])


def test_weekend_disabled_skips_to_monday():
    # Sat (5) and Sun (6) off -> from Friday evening the next deadline is Monday 07:00
    car = _car(_week(d5={"enabled": False}, d6={"enabled": False}))
    deadline, target = next_deadline(FRIDAY, car)
    assert deadline == datetime(2026, 9, 28, 7, 0, tzinfo=TZ)
    assert target == 80


def test_per_day_target_and_time():
    car = _car(_week(d5={"ready_by": "10:00", "target_soc": 95}))
    deadline, target = next_deadline(FRIDAY, car)
    assert deadline == datetime(2026, 9, 26, 10, 0, tzinfo=TZ) and target == 95


def test_today_still_counts_if_time_not_passed():
    car = _car(_week(d4={"ready_by": "23:00", "target_soc": 70}))  # Friday 23:00
    deadline, target = next_deadline(FRIDAY, car)
    assert deadline == datetime(2026, 9, 25, 23, 0, tzinfo=TZ) and target == 70


def test_all_days_disabled_means_no_plan():
    car = _car([{"enabled": False} for _ in range(7)])
    assert next_deadline(FRIDAY, car) == (None, None)
    day = FRIDAY.replace(hour=0)
    slots = [Slot(day + timedelta(hours=i), day + timedelta(hours=i + 1), 1.0) for i in range(24)]
    plan = plan_car(FRIDAY, slots, soc=50, car=car)
    assert plan["deadline"] is None and plan["in_plan_now"] is False
    assert not any(p["chosen"] for p in plan["plan"])


def test_plan_uses_schedule_target():
    car = _car(_week(d5={"ready_by": "09:00", "target_soc": 60}))
    day = FRIDAY.replace(hour=0)
    slots = [Slot(day + timedelta(hours=i), day + timedelta(hours=i + 1), 1.0) for i in range(24)]
    plan = plan_car(FRIDAY, slots, soc=50, car=car)
    assert plan["target_soc"] == 60
    assert plan["need_kwh"] == 6.0
    assert plan["deadline"] == datetime(2026, 9, 26, 9, 0, tzinfo=TZ).isoformat()


def test_per_day_source_defaults_and_validation():
    car = normalize_car({"name": "X", "source": "plan", "schedule": [{"source": "solar"}, {"source": "bogus"}]})
    assert car["schedule"][0]["source"] == "solar"
    assert car["schedule"][1]["source"] == "plan"  # invalid -> car default
    assert all(e["source"] == "plan" for e in car["schedule"][2:])


def test_plan_skips_grid_slots_on_solar_only_days():
    # Friday evening, deadline Saturday 07:00; Friday is solar-only, Saturday allows grid
    car = _car(_week(d4={"source": "solar"}, d5={"source": "solar_plan", "ready_by": "07:00"}))
    day = FRIDAY.replace(hour=0)
    prices = [1.0] * 48
    prices[22] = 0.1  # Friday 22:00 cheapest, but solar-only day
    prices[27] = 0.5  # Saturday 03:00
    slots = [Slot(day + timedelta(hours=i), day + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]
    plan = plan_car(FRIDAY, slots, soc=70, car=car)  # needs ~0.55 h -> 1 slot
    chosen = [datetime.fromisoformat(p["start"]) for p in plan["plan"] if p["chosen"]]
    assert chosen == [day + timedelta(hours=27)]
    assert plan["source_today"] == "solar"
