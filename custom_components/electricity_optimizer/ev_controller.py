"""Plans and controls EV charging based on prices."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .commands import async_run_command
from .const import AMPS_CHANGE_MIN_SECONDS, GRID_VOLTAGE
from .storage import CarStore

_LOGGER = logging.getLogger(__name__)


@dataclass
class Context:
    """Shared state for one evaluation round."""

    now: datetime
    slots: list[Slot]
    rules: dict[str, Any]
    battery_cfg: dict[str, Any] | None = None
    battery_soc: float | None = None
    battery_w: float | None = None  # + = charging
    grid_w: float | None = None  # + = import
    battery_grid_charging: bool = False  # battery intends to charge from grid this slot
    solar_w: float | None = None  # current solar production
    surplus_w: float | None = None  # solar export available for EVs (decremented as cars take it)
    battery_charge_w: float = 0.0  # what the house battery is charging with; a prioritised EV may claim it
    solar_forecast_kwh: dict[Any, float] = field(default_factory=dict)  # date -> forecast kWh (today/tomorrow)
    ev_grid_charging: bool = False
    ev_amps_total: float = 0.0


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


def day_source(car: dict[str, Any], when: datetime) -> str:
    """Charging source for the weekday of `when` (falls back to the car default)."""
    schedule = car.get("schedule") or []
    if len(schedule) == 7:
        return schedule[when.weekday()].get("source") or car.get("source", "solar_plan")
    return car.get("source", "solar_plan")


def next_deadline(now: datetime, car: dict[str, Any]) -> tuple[datetime | None, int | None]:
    """Find the next enabled weekday deadline from the car's weekly schedule."""
    schedule = car.get("schedule") or []
    if len(schedule) != 7:
        hh, mm = (int(p) for p in car["ready_by"].split(":"))
        deadline = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if deadline <= now:
            deadline += timedelta(days=1)
        return deadline, car["target_soc"]
    for offset in range(8):
        day = now + timedelta(days=offset)
        entry = schedule[day.weekday()]
        if not entry["enabled"]:
            continue
        hh, mm = (int(p) for p in entry["ready_by"].split(":"))
        deadline = day.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if deadline > now:
            return deadline, int(entry["target_soc"])
    return None, None


def plan_car(
    now: datetime,
    slots: list[Slot],
    soc: float,
    car: dict[str, Any],
) -> dict[str, Any]:
    """Return the plan for one car: which slots to charge in, and whether to charge now."""
    deadline, target = next_deadline(now, car)
    if deadline is None:
        target = car["target_soc"]
    need_kwh = max(0.0, (target - soc) / 100 * car["capacity_kwh"])
    need_hours = need_kwh / car["charge_power_kw"] if car["charge_power_kw"] > 0 else 0.0

    if deadline is None:
        current = next((s for s in slots if s.start <= now < s.end), None)
        return {
            "need_kwh": round(need_kwh, 2),
            "need_hours": round(need_hours, 2),
            "target_soc": target,
            "source_today": day_source(car, now),
            "deadline": None,
            "enough_time": True,
            "current_price": current.price if current else None,
            "in_plan_now": False,
            "next_start": None,
            "plan": [
                {"start": s.start.isoformat(), "end": s.end.isoformat(), "price": s.price, "estimated": False, "chosen": False}
                for s in slots
                if s.end > now
            ],
        }

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
        if day_source(car, s.start) == "solar":
            continue  # no grid charging on that day
        a = avail(s)
        if a <= 0:
            continue
        chosen.append(s)
        remaining -= a
    chosen.sort(key=lambda s: s.start)
    current = next((s for s in candidates if s.start <= now < s.end), None)
    charge_now_in_plan = current is not None and any(c.start == current.start for c in chosen)
    total_avail = sum(avail(s) for s in candidates if day_source(car, s.start) != "solar")
    next_slot = next((s for s in chosen if s.start > now), None)

    return {
        "need_kwh": round(need_kwh, 2),
        "need_hours": round(need_hours, 2),
        "target_soc": target,
        "source_today": day_source(car, now),
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
    """Decides per car whether to charge (grid plan or solar surplus) and sends commands."""

    def __init__(self, hass: HomeAssistant, store: CarStore, price_entity: str) -> None:
        self.hass = hass
        self.store = store
        self.price_entity = price_entity
        self.runtime: dict[str, dict[str, Any]] = {}
        self._last_cmd: dict[str, bool] = {}
        self._charging_since: dict[str, datetime] = {}
        self.notifier = None  # set by __init__
        self._last_amps: dict[str, float] = {}
        self._last_amps_at: dict[str, datetime] = {}

    # ---- sensors

    def _read_number(self, entity_id: str) -> tuple[float | None, str | None]:
        if not entity_id:
            return None, None
        st = self.hass.states.get(entity_id)
        if st is None or st.state in ("unknown", "unavailable"):
            return None, None
        try:
            return float(st.state), st.attributes.get("unit_of_measurement")
        except ValueError:
            return None, None

    def _read_soc(self, car: dict[str, Any]) -> float | None:
        return self._read_number(car["soc_entity"])[0]

    def _read_power_w(self, car: dict[str, Any]) -> float | None:
        value, unit = self._read_number(car.get("power_entity", ""))
        if value is None:
            return None
        return value * 1000 if (unit or "").lower() == "kw" else value

    def _is_plugged(self, car: dict[str, Any]) -> bool | None:
        if not car.get("plugged_entity"):
            return None
        st = self.hass.states.get(car["plugged_entity"])
        return None if st is None else st.state == "on"

    # ---- evaluation

    async def async_evaluate(self, ctx: Context) -> None:
        """Compute desired state for every car (in priority order) and apply it."""
        ctx.ev_grid_charging = False
        ctx.ev_amps_total = 0.0
        for car in list(self.store.cars):
            try:
                await self._evaluate_car(ctx, car)
            except Exception:  # noqa: BLE001 - keep other cars running
                _LOGGER.exception("Error evaluating car %s", car.get("name"))
        ids = {c["id"] for c in self.store.cars}
        for cid in list(self.runtime):
            if cid not in ids:
                self.runtime.pop(cid)
                self._last_cmd.pop(cid, None)
                self._last_amps.pop(cid, None)
                self._last_amps_at.pop(cid, None)

    async def _evaluate_car(self, ctx: Context, car: dict[str, Any]) -> None:
        now = ctx.now
        rt = self.runtime.setdefault(car["id"], {})
        rt["evaluated_at"] = now.isoformat()
        soc = self._read_soc(car)
        plugged = self._is_plugged(car)
        car_w = self._read_power_w(car)
        rt.update(soc=soc, plugged=plugged, car_w=car_w, amps=self._last_amps.get(car["id"]))
        rt["charging"] = self._last_cmd.get(car["id"], False)

        if soc is None:
            rt["status"] = "no_soc"
            rt["plan"] = None
            return

        plan = plan_car(now, ctx.slots, soc, car) if ctx.slots else None
        rt["plan"] = plan
        if not car["enabled"]:
            rt["status"] = "disabled"
            return

        desired = False
        mode: str | None = None  # grid | solar
        amps = car["max_amps"]
        source = day_source(car, now)
        rt["source_today"] = source
        uses_grid = source in ("plan", "solar_plan")
        uses_solar = source in ("solar", "solar_plan")

        target = plan["target_soc"] if plan else car["target_soc"]
        rt["target_soc"] = target
        self._notify_plan_problems(car, rt, plan, soc, plugged, target)
        if soc >= target:
            rt["status"] = "done"
            if car["charge_now"]:
                car["charge_now"] = False
                await self.store.async_save()
        elif plugged is False:
            rt["status"] = "not_plugged"
        elif car["charge_now"]:
            desired, mode, rt["status"] = True, "grid", "charge_now"
        elif uses_grid and plan and car["price_limit"] is not None and plan["current_price"] is not None and plan["current_price"] <= car["price_limit"]:
            desired, mode, rt["status"] = True, "grid", "below_limit"
        elif uses_grid and plan and plan["in_plan_now"]:
            desired, mode, rt["status"] = True, "grid", "charging"
        elif uses_solar:
            desired, amps = self._solar_decision(ctx, car, rt, car_w)
            mode = "solar" if desired else None
        else:
            rt["status"] = "no_prices" if plan is None else ("no_deadline" if plan["deadline"] is None else "waiting")

        if mode != "solar" and rt["status"] not in ("solar_wait", "solar_low"):
            self._reset_solar_timers(rt)

        # Main fuse: battery charging from grid has priority -> reduce or postpone the car.
        if desired and mode == "grid" and ctx.rules.get("max_total_amps") and ctx.rules["grid_priority"] == "battery" and ctx.battery_grid_charging and ctx.battery_cfg:
            battery_amps = ctx.battery_cfg["max_charge_kw"] * 1000 / (GRID_VOLTAGE * 3)
            allowed = ctx.rules["max_total_amps"] - battery_amps - ctx.ev_amps_total
            if allowed < car["min_amps"]:
                desired, mode, rt["status"] = False, None, "fuse_wait"
            else:
                amps = min(amps, int(allowed))
        elif desired and mode == "grid" and ctx.rules.get("max_total_amps"):
            allowed = ctx.rules["max_total_amps"] - ctx.ev_amps_total
            if allowed < car["min_amps"]:
                desired, mode, rt["status"] = False, None, "fuse_wait"
            else:
                amps = min(amps, int(allowed))

        rt["mode"] = mode if desired else None
        if desired:
            await self._apply_amps(ctx, car, amps, rate_limited=(mode == "solar"))
        await self._apply(car, desired)
        rt["charging"] = self._last_cmd.get(car["id"], False)
        rt["amps"] = self._last_amps.get(car["id"]) if desired else None
        rt["session"] = self._session(ctx, car, rt, plan, desired, mode, car_w, amps)
        if desired and mode == "grid":
            ctx.ev_grid_charging = True
        if desired:
            ctx.ev_amps_total += amps

    # ---- notifications

    def _notify_plan_problems(self, car: dict[str, Any], rt: dict[str, Any], plan: dict[str, Any] | None, soc: float, plugged: bool | None, target: float) -> None:
        if self.notifier is None or not car["enabled"] or plan is None or not plan.get("deadline") or soc >= target:
            return
        source = rt.get("source_today")
        if source not in ("plan", "solar_plan"):
            return
        deadline = datetime.fromisoformat(plan["deadline"])
        when = deadline.strftime("%H:%M")
        if not plan["enough_time"]:
            self.notifier.notify(
                f"deadline:{car['id']}:{plan['deadline']}",
                "Elbil når ikke mål-SoC",
                f"{car['name']} når ikke {target:.0f} % inden kl. {when}: der mangler {plan['need_kwh']:.1f} kWh "
                f"(ca. {plan['need_hours']:.1f} timer ved {car['charge_power_kw']:.1f} kW), men der er ikke timer nok tilbage.",
            )
        if plugged is False and plan["in_plan_now"]:
            self.notifier.notify(
                f"unplugged:{car['id']}:{plan['deadline']}",
                "Elbil ikke tilsluttet",
                f"{car['name']} skulle lade nu for at nå {target:.0f} % inden kl. {when}, men er ikke tilsluttet laderen.",
            )

    # ---- solar surplus

    @staticmethod
    def _reset_solar_timers(rt: dict[str, Any]) -> None:
        for key in ("solar_above_since", "solar_below_since", "prod_above_since", "prod_below_since"):
            rt[key] = None

    @staticmethod
    def _debounced(rt: dict[str, Any], key: str, condition: bool, active: bool, window_s: float, now: datetime) -> bool:
        """Start once `condition` has held for window_s; while active, stop once it has failed for window_s."""
        above, below = f"{key}_above_since", f"{key}_below_since"
        if condition:
            rt[below] = None
            if active:
                return True
            since = rt.get(above)
            if since is None:
                rt[above] = since = now.isoformat()
            return (now - datetime.fromisoformat(since)).total_seconds() >= window_s
        rt[above] = None
        if not active:
            return False
        since = rt.get(below)
        if since is None:
            rt[below] = since = now.isoformat()
        return (now - datetime.fromisoformat(since)).total_seconds() < window_s

    @staticmethod
    def _solar_priority(ctx: Context, car_soc: float | None) -> str | None:
        """Who has solar priority right now: "ev", "battery" or None (used normally).

        No. 1 in the rules only wins while its own SoC is inside [under, over].
        """
        rules = ctx.rules
        first = rules["solar_priority"]
        if first == "battery":
            if ctx.battery_cfg is None or ctx.battery_soc is None:
                return None
            soc = ctx.battery_soc
        else:
            if car_soc is None:
                return None
            soc = car_soc
        if rules["solar_priority_under"] <= soc <= rules["solar_priority_over"]:
            return first
        return None

    def _solar_decision(self, ctx: Context, car: dict[str, Any], rt: dict[str, Any], car_w: float | None) -> tuple[bool, int]:
        """Return (charge, amps) for solar surplus charging, with start/stop hysteresis."""
        rules = ctx.rules
        if ctx.surplus_w is None:
            rt["status"] = "no_grid_sensor"
            return False, car["max_amps"]
        priority = self._solar_priority(ctx, rt.get("soc"))
        rt["solar_priority"] = priority
        if priority == "battery":
            rt["status"] = "battery_first"
            self._reset_solar_timers(rt)
            return False, car["max_amps"]

        now = ctx.now
        window_s = rules["solar_min_minutes"] * 60
        currently_solar = rt.get("mode") == "solar" and self._last_cmd.get(car["id"], False)
        min_w = rules.get("solar_min_w")
        if min_w:
            if ctx.solar_w is None:
                rt["status"] = "no_solar_sensor"
                return False, car["max_amps"]
            rt["solar_w"] = round(ctx.solar_w)
            if not self._debounced(rt, "prod", ctx.solar_w >= min_w, currently_solar, window_s, now):
                rt["status"] = "solar_low"
                rt["solar_above_since"] = rt["solar_below_since"] = None
                return False, car["max_amps"]

        per_amp = GRID_VOLTAGE * car["phases"]
        available = ctx.surplus_w  # may be negative when the house is importing
        if priority == "ev" and ctx.battery_charge_w > 0:
            # the car outranks the battery: what the battery is charging with is up for grabs
            available += ctx.battery_charge_w
            ctx.battery_charge_w = 0.0
        if currently_solar:
            # the car's own draw is already inside the house load; give it back
            own = car_w if car_w is not None else (self._last_amps.get(car["id"]) or car["min_amps"]) * per_amp
            available += own
        modulating = bool(car.get("current_entity"))
        need_w = (car["min_amps"] if modulating else car["max_amps"]) * per_amp
        rt["surplus_w"] = round(available)

        if not self._debounced(rt, "solar", available >= need_w, currently_solar, window_s, now):
            rt["status"] = "solar_wait"
            return False, car["max_amps"]
        amps = int(available // per_amp) if modulating else car["max_amps"]
        amps = max(car["min_amps"], min(car["max_amps"], amps))
        ctx.surplus_w = available - amps * per_amp
        rt["status"] = "solar"
        return True, amps

    # ---- commands

    async def _apply_amps(self, ctx: Context, car: dict[str, Any], amps: int, *, rate_limited: bool = False) -> None:
        """Push the current limit to the charger (only on change; solar modulation is rate limited)."""
        cid = car["id"]
        entity = car.get("current_entity")
        if not entity:
            self._last_amps[cid] = amps
            return
        last = self._last_amps.get(cid)
        if last == amps:
            return
        last_at = self._last_amps_at.get(cid)
        if rate_limited and last is not None and last_at is not None and (ctx.now - last_at).total_seconds() < AMPS_CHANGE_MIN_SECONDS:
            return
        try:
            await async_run_command(self.hass, entity, str(amps))
            self._last_amps[cid] = amps
            self._last_amps_at[cid] = ctx.now
            _LOGGER.info("%s: set current limit to %s A", car["name"], amps)
        except HomeAssistantError as err:
            self.runtime[cid]["last_action"] = {"at": ctx.now.isoformat(), "action": "set_amps", "ok": False, "error": str(err)}
            _LOGGER.warning("%s: could not set current limit: %s", car["name"], err)
            if self.notifier is not None:
                self.notifier.notify(f"amps:{cid}", "Elbil-kommando fejlede", f"{car['name']}: kunne ikke sætte ladestrøm til {amps} A – {err}")

    def _session(self, ctx: Context, car: dict[str, Any], rt: dict[str, Any], plan: dict[str, Any] | None, desired: bool, mode: str | None, car_w: float | None, amps: int) -> dict[str, Any] | None:
        """Charging period for the chart: when charging starts and is expected to finish.

        Solar (and price-limit / manual) charging: from when it started until the remaining kWh are
        in at the current power - an estimate that moves with production and house load.
        Planned grid charging: first to last chosen slot.
        """
        now = ctx.now
        cid = car["id"]
        if desired and (mode == "solar" or rt["status"] in ("charge_now", "below_limit")):
            since = self._charging_since.get(cid, now)
            if mode == "solar":
                power_w = car_w if car_w and car_w > 0 else amps * GRID_VOLTAGE * car["phases"]
            else:
                power_w = car["charge_power_kw"] * 1000
            soc = rt.get("soc")
            need_kwh = plan["need_kwh"] if plan else max(0.0, (rt["target_soc"] - (soc or 0)) / 100 * car["capacity_kwh"])
            end = now + timedelta(hours=need_kwh * 1000 / power_w) if power_w > 0 else None
            return {"start": since.isoformat(), "end": end.isoformat() if end else None, "source": mode, "estimated": True}
        if plan and plan.get("plan"):
            chosen = [sl for sl in plan["plan"] if sl["chosen"]]
            if chosen:
                start = self._charging_since.get(cid) if desired and mode == "grid" else None
                start = start or datetime.fromisoformat(chosen[0]["start"])
                end = datetime.fromisoformat(chosen[-1]["end"])
                return {"start": start.isoformat(), "end": end.isoformat(), "source": "grid", "estimated": any(sl.get("estimated") for sl in chosen)}
        return None

    async def _apply(self, car: dict[str, Any], desired: bool) -> None:
        cid = car["id"]
        if self._last_cmd.get(cid) is desired:
            return
        if desired:
            self._charging_since[cid] = dt_util.now()
        else:
            self._charging_since.pop(cid, None)
            self._last_amps.pop(cid, None)  # re-send the limit next time charging starts
            self._last_amps_at.pop(cid, None)
        try:
            if desired:
                await self._activate(car)
            else:
                await self._deactivate(car)
            self._last_cmd[cid] = desired
            self.runtime[cid]["last_action"] = {"at": dt_util.now().isoformat(), "action": "start" if desired else "stop", "ok": True}
            _LOGGER.info("%s: sent %s", car["name"], "start" if desired else "stop")
            if self.notifier is not None:
                self.notifier.clear(f"cmd:{cid}")
        except HomeAssistantError as err:
            self.runtime[cid]["last_action"] = {"at": dt_util.now().isoformat(), "action": "start" if desired else "stop", "ok": False, "error": str(err)}
            _LOGGER.warning("%s: could not send %s: %s", car["name"], "start" if desired else "stop", err)
            if self.notifier is not None:
                self.notifier.notify(f"cmd:{cid}", "Elbil-kommando fejlede", f"{car['name']}: kunne ikke sende {'start' if desired else 'stop'} – {err}")

    async def _activate(self, car: dict[str, Any]) -> None:
        await async_run_command(self.hass, car["start_entity"], car.get("start_value") or None)

    async def _deactivate(self, car: dict[str, Any]) -> None:
        await async_run_command(self.hass, car["stop_entity"], car.get("stop_value") or None, is_stop=True, start_entity=car["start_entity"])
