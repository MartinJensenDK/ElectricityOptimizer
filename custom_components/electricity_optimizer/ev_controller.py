"""Plans and controls EV charging based on prices."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .commands import async_run_command
from .const import EVALUATE_INTERVAL_SECONDS
from .storage import CarStore

_LOGGER = logging.getLogger(__name__)


@dataclass
class Slot:
    start: datetime
    end: datetime
    price: float
    estimated: bool = False

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600


def _to_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        dt = dt_util.parse_datetime(value)
        if dt is None:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
    return dt_util.as_local(dt)


def read_price_slots(hass: HomeAssistant, price_entity: str) -> list[Slot]:
    """Build a sorted list of known price slots from the EnergiDataService sensor."""
    state = hass.states.get(price_entity)
    if state is None:
        return []
    attrs = state.attributes
    raw: list[Any] = list(attrs.get("raw_today") or [])
    if attrs.get("tomorrow_valid"):
        raw += list(attrs.get("raw_tomorrow") or [])
    points: list[tuple[datetime, float]] = []
    for item in raw:
        try:
            start = _to_dt(item["hour"])
            price = float(item["price"])
        except (KeyError, TypeError, ValueError):
            continue
        if start is not None:
            points.append((start, price))
    points.sort(key=lambda p: p[0])
    if not points:
        return []
    if len(points) >= 2:
        duration = points[1][0] - points[0][0]
    else:
        duration = timedelta(hours=1)
    return [Slot(start, start + duration, price) for start, price in points]


def plan_car(
    now: datetime,
    slots: list[Slot],
    soc: float,
    car: dict[str, Any],
) -> dict[str, Any]:
    """Return the plan for one car: which slots to charge in, and whether to charge now."""
    need_kwh = max(0.0, (car["target_soc"] - soc) / 100 * car["capacity_kwh"])
    need_hours = need_kwh / car["charge_power_kw"] if car["charge_power_kw"] > 0 else 0.0

    hh, mm = (int(p) for p in car["ready_by"].split(":"))
    deadline = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if deadline <= now:
        deadline += timedelta(days=1)

    candidates = [s for s in slots if s.end > now and s.start < deadline]
    duration = slots[0].end - slots[0].start if slots else timedelta(hours=1)
    known_prices = [s.price for s in slots] or [0.0]
    estimate = sum(known_prices) / len(known_prices)
    cursor = candidates[-1].end if candidates else (slots[-1].end if slots else now.replace(minute=0, second=0, microsecond=0))
    if cursor < now:
        cursor = now.replace(minute=0, second=0, microsecond=0)
    while cursor < deadline:
        candidates.append(Slot(cursor, cursor + duration, estimate, estimated=True))
        cursor += duration

    # Available hours per candidate (current slot is partial).
    def avail(s: Slot) -> float:
        start = max(s.start, now)
        end = min(s.end, deadline)
        return max(0.0, (end - start).total_seconds() / 3600)

    chosen: list[Slot] = []
    remaining = need_hours
    for s in sorted(candidates, key=lambda s: (s.price, s.start)):
        if remaining <= 0:
            break
        a = avail(s)
        if a <= 0:
            continue
        chosen.append(s)
        remaining -= a
    chosen.sort(key=lambda s: s.start)
    current = next((s for s in candidates if s.start <= now < s.end), None)
    charge_now_in_plan = current is not None and any(c.start == current.start for c in chosen)
    total_avail = sum(avail(s) for s in candidates)
    next_slot = next((s for s in chosen if s.start > now), None)

    return {
        "need_kwh": round(need_kwh, 2),
        "need_hours": round(need_hours, 2),
        "deadline": deadline.isoformat(),
        "enough_time": total_avail >= need_hours,
        "current_price": current.price if current else None,
        "in_plan_now": charge_now_in_plan,
        "next_start": next_slot.start.isoformat() if next_slot else None,
        "plan": [
            {
                "start": s.start.isoformat(),
                "end": s.end.isoformat(),
                "price": s.price,
                "estimated": s.estimated,
                "chosen": any(c.start == s.start for c in chosen),
            }
            for s in candidates
        ],
    }


class EvController:
    """Evaluates every minute and sends start/stop commands."""

    def __init__(self, hass: HomeAssistant, store: CarStore, price_entity: str) -> None:
        self.hass = hass
        self.store = store
        self.price_entity = price_entity
        self.runtime: dict[str, dict[str, Any]] = {}
        self._last_cmd: dict[str, bool] = {}
        self._unsub = None

    @callback
    def async_start(self) -> None:
        self._unsub = async_track_time_interval(
            self.hass, self._async_tick, timedelta(seconds=EVALUATE_INTERVAL_SECONDS)
        )

    @callback
    def async_stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    async def _async_tick(self, _now: datetime) -> None:
        await self.async_evaluate()

    def _read_soc(self, car: dict[str, Any]) -> float | None:
        st = self.hass.states.get(car["soc_entity"])
        if st is None or st.state in ("unknown", "unavailable"):
            return None
        try:
            return float(st.state)
        except ValueError:
            return None

    def _is_plugged(self, car: dict[str, Any]) -> bool | None:
        if not car.get("plugged_entity"):
            return None
        st = self.hass.states.get(car["plugged_entity"])
        if st is None:
            return None
        return st.state == "on"

    async def async_evaluate(self) -> None:
        """Compute desired state for every car and apply it."""
        now = dt_util.now()
        slots = read_price_slots(self.hass, self.price_entity)
        for car in list(self.store.cars):
            try:
                await self._evaluate_car(now, slots, car)
            except Exception:  # noqa: BLE001 - keep other cars running
                _LOGGER.exception("Error evaluating car %s", car.get("name"))
        # drop runtime for deleted cars
        ids = {c["id"] for c in self.store.cars}
        for cid in list(self.runtime):
            if cid not in ids:
                self.runtime.pop(cid)
                self._last_cmd.pop(cid, None)

    async def _evaluate_car(self, now: datetime, slots: list[Slot], car: dict[str, Any]) -> None:
        rt = self.runtime.setdefault(car["id"], {})
        rt["evaluated_at"] = now.isoformat()
        soc = self._read_soc(car)
        plugged = self._is_plugged(car)
        rt["soc"] = soc
        rt["plugged"] = plugged
        rt["charging"] = self._last_cmd.get(car["id"], False)

        if soc is None:
            rt["status"] = "no_soc"
            rt["plan"] = None
            return

        plan = plan_car(now, slots, soc, car) if slots else None
        rt["plan"] = plan
        if not slots:
            rt["status"] = "no_prices"

        if not car["enabled"]:
            rt["status"] = "disabled"
            return

        desired: bool
        if soc >= car["target_soc"]:
            desired = False
            rt["status"] = "done"
            if car["charge_now"]:
                car["charge_now"] = False
                await self.store.async_save()
        elif plugged is False:
            desired = False
            rt["status"] = "not_plugged"
        elif car["charge_now"]:
            desired = True
            rt["status"] = "charge_now"
        elif plan is None:
            return
        elif car["price_limit"] is not None and plan["current_price"] is not None and plan["current_price"] <= car["price_limit"]:
            desired = True
            rt["status"] = "below_limit"
        else:
            desired = plan["in_plan_now"]
            rt["status"] = "charging" if desired else "waiting"

        await self._apply(car, desired)
        rt["charging"] = self._last_cmd.get(car["id"], False)

    async def _apply(self, car: dict[str, Any], desired: bool) -> None:
        cid = car["id"]
        if self._last_cmd.get(cid) is desired:
            return
        try:
            if desired:
                await self._activate(car)
            else:
                await self._deactivate(car)
            self._last_cmd[cid] = desired
            self.runtime[cid]["last_action"] = {
                "at": dt_util.now().isoformat(),
                "action": "start" if desired else "stop",
                "ok": True,
            }
            _LOGGER.info("%s: sent %s", car["name"], "start" if desired else "stop")
        except HomeAssistantError as err:
            self.runtime[cid]["last_action"] = {
                "at": dt_util.now().isoformat(),
                "action": "start" if desired else "stop",
                "ok": False,
                "error": str(err),
            }
            _LOGGER.warning("%s: could not send %s: %s", car["name"], "start" if desired else "stop", err)

    async def _activate(self, car: dict[str, Any]) -> None:
        await async_run_command(self.hass, car["start_entity"], car.get("start_value") or None)

    async def _deactivate(self, car: dict[str, Any]) -> None:
        await async_run_command(
            self.hass,
            car["stop_entity"],
            car.get("stop_value") or None,
            is_stop=True,
            start_entity=car["start_entity"],
        )
