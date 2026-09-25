"""Tests for the pure planning logic."""

from datetime import datetime, timedelta

from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.ev_controller import Slot, plan_car

TZ = dt_util.get_time_zone("Europe/Copenhagen")


def _hourly_slots(day: datetime, prices: list[float]) -> list[Slot]:
    return [Slot(day + timedelta(hours=i), day + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]


def _car(**overrides):
    car = {
        "id": "x",
        "name": "Car",
        "capacity_kwh": 60.0,
        "charge_power_kw": 11.0,
        "target_soc": 80,
        "ready_by": "07:00",
        "price_limit": None,
        "charge_now": False,
        "enabled": True,
    }
    car.update(overrides)
    return car


def test_picks_cheapest_slots_before_deadline():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.0] * 24
    prices[20] = 0.2  # cheapest
    prices[22] = 0.3  # second cheapest
    prices[18] = 0.9
    slots = _hourly_slots(day, prices)
    now = day + timedelta(hours=18)
    # need (80-50)/100*60 = 18 kWh / 11 kW = 1.64 h -> 2 slots
    plan = plan_car(now, slots, soc=50, car=_car())

    chosen = [p for p in plan["plan"] if p["chosen"]]
    assert [datetime.fromisoformat(c["start"]).hour for c in chosen] == [20, 22]
    assert plan["in_plan_now"] is False
    assert plan["need_kwh"] == 18.0
    assert plan["enough_time"] is True
    assert datetime.fromisoformat(plan["deadline"]) == day + timedelta(days=1, hours=7)
    # unknown tomorrow hours are padded with estimated slots up to the deadline
    estimated = [p for p in plan["plan"] if p["estimated"]]
    assert len(estimated) == 7
    assert datetime.fromisoformat(plan["next_start"]).hour == 20


def test_current_slot_is_chosen_when_cheapest():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    prices = [1.0] * 24
    prices[18] = 0.1
    slots = _hourly_slots(day, prices)
    now = day + timedelta(hours=18, minutes=30)
    plan = plan_car(now, slots, soc=70, car=_car())  # need 6 kWh -> 0.55 h
    assert plan["in_plan_now"] is True
    chosen = [p for p in plan["plan"] if p["chosen"]]
    # the partial current slot only offers 0.5 h, so one more slot is needed
    assert len(chosen) == 2


def test_no_need_when_at_target():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    slots = _hourly_slots(day, [1.0] * 24)
    plan = plan_car(day + timedelta(hours=10), slots, soc=85, car=_car())
    assert plan["need_kwh"] == 0
    assert not any(p["chosen"] for p in plan["plan"])
    assert plan["in_plan_now"] is False


def test_not_enough_time_flags_and_charges_everything():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    slots = _hourly_slots(day, [1.0] * 24)
    now = day + timedelta(hours=6)
    plan = plan_car(now, slots, soc=0, car=_car(ready_by="07:00"))  # 48 kWh needed, 1 h left
    assert plan["enough_time"] is False
    assert plan["in_plan_now"] is True


def test_deadline_rolls_to_tomorrow_when_passed():
    day = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
    slots = _hourly_slots(day, [1.0] * 24)
    now = day + timedelta(hours=8)
    plan = plan_car(now, slots, soc=50, car=_car(ready_by="07:00"))
    assert datetime.fromisoformat(plan["deadline"]) == day + timedelta(days=1, hours=7)
