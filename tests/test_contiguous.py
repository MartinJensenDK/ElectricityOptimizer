"""The "sammenhængende opladning" option: one unbroken block of hours instead of the cheapest single hours."""

from datetime import datetime, timedelta

from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.battery_controller import plan_battery
from custom_components.electricity_optimizer.ev_controller import Slot, cheapest_window, longest_run, plan_car
from custom_components.electricity_optimizer.storage import normalize_battery, normalize_car

TZ = dt_util.get_time_zone("Europe/Copenhagen")
DAY = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)  # a Friday


def _slots(prices):
    return [Slot(DAY + timedelta(hours=i), DAY + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]


def _car(**overrides):
    car = {"id": "x", "name": "Car", "capacity_kwh": 60.0, "charge_power_kw": 11.0, "target_soc": 80, "ready_by": "07:00", "price_limit": None, "charge_now": False, "enabled": True}
    car.update(overrides)
    return car


def _chosen(plan):
    return [datetime.fromisoformat(p["start"]).hour for p in plan["plan"] if p["chosen"]]


def _charge_hours(plan):
    return [datetime.fromisoformat(p["start"]).hour for p in plan["plan"] if p["mode"] == "charge"]


def test_option_defaults_to_off_and_is_a_bool():
    assert normalize_car({"name": "A"})["contiguous"] is False
    assert normalize_car({"contiguous": True}, normalize_car({"name": "A"}))["contiguous"] is True
    assert normalize_battery({"soc_entity": "sensor.s"})["contiguous"] is False
    assert normalize_battery({"contiguous": True}, normalize_battery({"soc_entity": "sensor.s"}))["contiguous"] is True


def test_cheapest_window_helpers():
    slots = _slots([5, 1, 9, 2, 2, 9])
    full = lambda s: 1.0  # noqa: E731
    assert [s.price for s in cheapest_window(slots, 2, full)] == [2, 2]
    assert [s.price for s in cheapest_window(slots, 1.5, full)] == [2, 2]  # 2 + 0.5*2 beats 1 + 0.5*9
    assert [s.price for s in cheapest_window(slots, 2, full, start_at=slots[0].start)] == [5, 1]  # a started block is finished
    assert cheapest_window(slots[:2] + slots[3:], 4, full) is None  # the gap breaks the run
    assert [s.price for s in longest_run(slots[:2] + slots[3:], full)] == [2, 2, 9]


def test_car_charges_in_one_block():
    prices = [1.0] * 24
    prices[20] = 0.2  # cheapest single hour
    prices[22] = 0.3
    prices[23] = 0.4
    now = DAY + timedelta(hours=18)
    # need (80-50)/100*60 = 18 kWh / 11 kW = 1.64 h -> 2 slots
    plan = plan_car(now, _slots(prices), soc=50, car=_car())
    assert _chosen(plan) == [20, 22] and plan["contiguous"] is False
    plan = plan_car(now, _slots(prices), soc=50, car=_car(contiguous=True))
    assert _chosen(plan) == [22, 23] and plan["contiguous"] is True  # 0.3 + 0.64*0.4 beats 0.2 + 0.64*1.0
    assert plan["in_plan_now"] is False and plan["next_start"] == (DAY + timedelta(hours=22)).isoformat()


def test_car_finishes_a_started_block():
    prices = [1.0] * 24
    prices[22] = prices[23] = 0.1
    now = DAY + timedelta(hours=20, minutes=30)
    car = _car(contiguous=True)
    assert _chosen(plan_car(now, _slots(prices), soc=50, car=car)) == [22, 23]
    plan = plan_car(now, _slots(prices), soc=50, car=car, continue_now=True)
    assert _chosen(plan) == [20, 21, 22] and plan["in_plan_now"] is True  # 0.5 h left of the current hour
    # without the option the flag changes nothing
    assert _chosen(plan_car(now, _slots(prices), soc=50, car=_car(), continue_now=True)) == [22, 23]


def test_car_falls_back_to_single_hours_when_no_block_is_long_enough():
    prices = [1.0] * 24 + [1.0] * 24
    slots = [Slot(DAY + timedelta(hours=i), DAY + timedelta(hours=i + 1), p) for i, p in enumerate(prices)]
    now = DAY + timedelta(hours=30)  # Saturday 06:00, one hour before the deadline
    plan = plan_car(now, slots, soc=0, car=_car(contiguous=True))
    assert plan["enough_time"] is False and plan["contiguous"] is False
    assert [p["chosen"] for p in plan["plan"]] == [True]


def _battery(**kw):
    week = [{"enabled": True, "grid_charge": True, "ready_by": "17:00", "target_soc": None} for _ in range(7)]
    week[4].update(kw.pop("friday", {}))
    return normalize_battery({"soc_entity": "sensor.s", "capacity_kwh": 20, "max_charge_kw": 5, "spread_threshold": 0.5, "schedule": week, **kw})


def _battery_prices():
    prices = [1.0] * 24
    prices[2], prices[3], prices[5], prices[6] = 0.2, 0.5, 0.25, 0.3
    prices[17] = prices[18] = prices[19] = 3.0
    return prices


def test_battery_arbitrage_charges_in_one_block():
    now = DAY + timedelta(hours=1)
    # room (100-50) % of 20 kWh = 10 kWh / 5 kW = 2 h
    assert _charge_hours(plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery())) == [2, 5]
    assert _charge_hours(plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery(contiguous=True))) == [5, 6]  # 0.55 beats 0.2 + 0.5
    # charging already: the block that was started at 01:00 is finished
    plan = plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery(contiguous=True), continue_now=True)
    assert _charge_hours(plan) == [1, 2] and plan["auto_mode"] == "charge"


def test_battery_uses_the_longest_profitable_block_when_none_is_long_enough():
    now = DAY + timedelta(hours=1)
    # only hours 2, 5 and 6 are cheap enough for a 2.2 spread (3.0 * 0.9 - price >= 2.2); 15 kWh needs 3 h
    cfg = {"capacity_kwh": 30, "spread_threshold": 2.2}
    assert _charge_hours(plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery(**cfg))) == [2, 5, 6]
    assert _charge_hours(plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery(contiguous=True, **cfg))) == [5, 6]


def test_battery_target_soc_is_reached_in_one_block():
    now = DAY + timedelta(hours=1)
    cfg = {"spread_threshold": 10, "friday": {"target_soc": 100, "ready_by": "17:00"}}  # no arbitrage, only the weekly target
    assert _charge_hours(plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery(**cfg))) == [2, 5]
    assert _charge_hours(plan_battery(now, _slots(_battery_prices()), soc=50, cfg=_battery(contiguous=True, **cfg))) == [5, 6]
    # no block before the deadline is long enough -> the cheapest single hours after all
    late = DAY + timedelta(hours=16)
    assert _charge_hours(plan_battery(late, _slots(_battery_prices()), soc=50, cfg=_battery(contiguous=True, **cfg))) == [16]
