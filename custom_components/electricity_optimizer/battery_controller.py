"""Plans and controls the house battery: normal / hold / charge from grid."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .commands import async_run_command
from .const import GRID_VOLTAGE
from .ev_controller import Context, Slot
from .storage import BatteryStore

_LOGGER = logging.getLogger(__name__)


def _day_entry(cfg: dict[str, Any], when: datetime) -> dict[str, Any]:
    schedule = cfg.get("schedule") or []
    if len(schedule) == 7:
        return schedule[when.weekday()]
    return {"enabled": True, "grid_charge": cfg.get("grid_charge_enabled", False), "ready_by": "17:00", "target_soc": None}


def next_battery_deadline(now: datetime, cfg: dict[str, Any]) -> tuple[datetime | None, int | None]:
    """Next enabled day with a target SoC and a deadline still ahead."""
    schedule = cfg.get("schedule") or []
    if len(schedule) != 7:
        return None, None
    for offset in range(8):
        day = now + timedelta(days=offset)
        entry = schedule[day.weekday()]
        if not entry["enabled"] or entry["target_soc"] is None or not entry["grid_charge"]:
            continue
        hh, mm = (int(p) for p in entry["ready_by"].split(":"))
        deadline = day.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if deadline > now:
            return deadline, int(entry["target_soc"])
    return None, None


def plan_battery(
    now: datetime,
    slots: list[Slot],
    soc: float,
    cfg: dict[str, Any],
    forecast: dict[Any, float] | None = None,
) -> dict[str, Any] | None:
    """Assign a mode to every known future slot.

    hold:   price below the day's mean and a later slot is at least `spread_threshold` dearer.
    charge: (a) grid charging allowed that day, room in the battery, and the cheapest slots whose price
            is at least `spread_threshold` below the (efficiency-adjusted) average of the dearest later
            slots; or (b) the cheapest slots needed to reach the weekly schedule's target SoC before its
            deadline.
    normal: everything else, and every slot on a day that is switched off in the schedule.

    Grid charging on a day is also skipped when a solar forecast for that day is known and at least
    `grid_charge_max_forecast_kwh` (when that limit is set).
    """
    candidates = [s for s in slots if s.end > now]
    if not candidates:
        return None
    thr = cfg["spread_threshold"]
    eff = cfg["efficiency"]
    forecast = forecast or {}
    limit = cfg.get("grid_charge_max_forecast_kwh")

    def grid_allowed(when: datetime) -> bool:
        entry = _day_entry(cfg, when)
        if not entry["enabled"] or not entry["grid_charge"]:
            return False
        if limit is not None:
            fc = forecast.get(when.date())
            if fc is not None and fc >= limit:
                return False
        return True

    by_day: dict[Any, list[float]] = {}
    for s in slots:
        by_day.setdefault(s.start.date(), []).append(s.price)
    day_mean = {d: sum(v) / len(v) for d, v in by_day.items()}

    modes: dict[datetime, str] = {}
    for i, s in enumerate(candidates):
        if not _day_entry(cfg, s.start)["enabled"]:
            continue
        later = candidates[i + 1 :]
        if not later:
            continue
        later_max = max(x.price for x in later)
        if s.price < day_mean[s.start.date()] and later_max - s.price >= thr:
            modes[s.start] = "hold"

    charge_hours = 0.0
    if soc < cfg["max_soc"]:
        room_kwh = (cfg["max_soc"] - soc) / 100 * cfg["capacity_kwh"]
        charge_hours = room_kwh / cfg["max_charge_kw"]
        slot_hours = candidates[0].hours or 1.0
        n_expensive = max(1, math.ceil(charge_hours / slot_hours))
        remaining = charge_hours
        for s in sorted(candidates, key=lambda s: (s.price, s.start)):
            if remaining <= 0:
                break
            if not grid_allowed(s.start):
                continue
            later = [x for x in candidates if x.start > s.start]
            if not later:
                continue
            dearest = sorted((x.price for x in later), reverse=True)[:n_expensive]
            if (sum(dearest) / len(dearest)) * eff - s.price >= thr:
                modes[s.start] = "charge"
                avail_start = max(s.start, now)
                remaining -= (s.end - avail_start).total_seconds() / 3600

    # (b) weekly schedule target: reach target_soc before the deadline in the cheapest slots
    deadline, target = next_battery_deadline(now, cfg)
    target_hours = 0.0
    if deadline is not None and target is not None and soc < target:
        need_kwh = (target - soc) / 100 * cfg["capacity_kwh"]
        target_hours = need_kwh / cfg["max_charge_kw"]
        duration = candidates[0].end - candidates[0].start
        before = [s for s in candidates if s.start < deadline]
        estimate = sum(x.price for x in slots) / len(slots)
        cursor = before[-1].end if before else now.replace(minute=0, second=0, microsecond=0)
        if cursor < now:
            cursor = now.replace(minute=0, second=0, microsecond=0)
        extra: list[Slot] = []
        while cursor < deadline:
            extra.append(Slot(cursor, cursor + duration, estimate, estimated=True))
            cursor += duration
        pool = before + extra
        remaining = target_hours
        for s in sorted(pool, key=lambda s: (s.price, s.start)):
            if remaining <= 0:
                break
            if not grid_allowed(s.start):
                continue
            avail = max(0.0, (min(s.end, deadline) - max(s.start, now)).total_seconds() / 3600)
            if avail <= 0:
                continue
            modes[s.start] = "charge"
            remaining -= avail

    current = next((s for s in candidates if s.start <= now < s.end), None)
    today = _day_entry(cfg, now)
    auto_mode = modes.get(current.start, "normal") if current else "normal"
    if not today["enabled"]:
        auto_mode = "normal"
    later_max = max((s.price for s in candidates if current and s.start > current.start), default=None)
    fc_today = forecast.get(now.date())
    fc_tomorrow = forecast.get((now + timedelta(days=1)).date())
    return {
        "auto_mode": auto_mode,
        "day_enabled": bool(today["enabled"]),
        "grid_charge_today": bool(today["grid_charge"]),
        "forecast": {
            "limit": limit,
            "today": fc_today,
            "tomorrow": fc_tomorrow,
            "blocked_today": limit is not None and fc_today is not None and fc_today >= limit,
            "blocked_tomorrow": limit is not None and fc_tomorrow is not None and fc_tomorrow >= limit,
        },
        "deadline": deadline.isoformat() if deadline else None,
        "target_soc": target,
        "target_hours": round(target_hours, 2),
        "current_price": current.price if current else None,
        "day_mean": day_mean.get(current.start.date()) if current else None,
        "later_max": later_max,
        "charge_hours": round(charge_hours, 2),
        "plan": [
            {
                "start": s.start.isoformat(),
                "end": s.end.isoformat(),
                "price": s.price,
                "mode": modes.get(s.start, "normal"),
            }
            for s in candidates
        ],
    }


class BatteryController:
    """Evaluates the battery plan and sends mode commands when the mode changes."""

    def __init__(self, hass: HomeAssistant, store: BatteryStore, price_entity: str) -> None:
        self.hass = hass
        self.store = store
        self.price_entity = price_entity
        self.runtime: dict[str, Any] = {}
        self._active: str | None = None  # last commanded mode

    def _number(self, entity_id: str) -> float | None:
        if not entity_id:
            return None
        st = self.hass.states.get(entity_id)
        if st is None or st.state in ("unknown", "unavailable"):
            return None
        try:
            return float(st.state)
        except ValueError:
            return None

    def read_live(self) -> dict[str, float | None]:
        """Live sensor values used by the optimizer context."""
        cfg = self.store.battery
        if cfg is None:
            return {"soc": None, "battery_w": None, "grid_w": None}
        soc = self._number(cfg["soc_entity"])
        battery_w: float | None = None
        if cfg["power_entity"]:
            v = self._number(cfg["power_entity"])
            if v is not None:
                battery_w = v * (-1 if cfg["power_sign"] == "discharge_positive" else 1)
        elif cfg["charge_power_entity"] or cfg["discharge_power_entity"]:
            c = self._number(cfg["charge_power_entity"]) or 0.0
            d = self._number(cfg["discharge_power_entity"]) or 0.0
            battery_w = c - d
        grid_w: float | None = None
        if cfg["grid_power_entity"]:
            v = self._number(cfg["grid_power_entity"])
            if v is not None:
                grid_w = v * (-1 if cfg["grid_sign"] == "export_positive" else 1)
        return {"soc": soc, "battery_w": battery_w, "grid_w": grid_w}

    def compute(self, ctx: Context) -> str | None:
        """Plan and decide the intended mode; returns the mode or None when nothing can be done."""
        cfg = self.store.battery
        if cfg is None:
            self.runtime = {}
            return None
        rt = self.runtime
        rt["evaluated_at"] = ctx.now.isoformat()
        soc = ctx.battery_soc
        rt["soc"] = soc
        rt["commands_configured"] = {"charge": bool(cfg["charge_start_entity"]), "hold": bool(cfg["hold_start_entity"])}
        if soc is None:
            rt["status"] = "no_soc"
            rt["plan"] = None
            return None
        plan = plan_battery(ctx.now, ctx.slots, soc, cfg, ctx.solar_forecast_kwh) if ctx.slots else None
        rt["plan"] = plan
        if plan is None:
            rt["status"] = "no_prices"
            rt["mode"] = "normal"
            return None
        if not cfg["enabled"]:
            rt["status"] = "disabled"
            rt["mode"] = "normal"
            return None
        if cfg["override"] != "auto":
            mode = cfg["override"]
            rt["status"] = "override"
        elif not plan["day_enabled"]:
            mode = "normal"
            rt["status"] = "day_off"
        else:
            mode = plan["auto_mode"]
            rt["status"] = "auto"
        if mode == "charge" and soc >= cfg["max_soc"]:
            mode = "normal"
            rt["status"] = "full"
        rt["mode"] = mode
        return mode

    async def async_apply(self, ctx: Context, mode: str | None) -> None:
        """Apply the mode after the EV round, honouring the shared rules."""
        cfg = self.store.battery
        if cfg is None or mode is None:
            return
        rt = self.runtime
        rules = ctx.rules
        if cfg["override"] == "auto":
            if mode == "normal" and ctx.ev_grid_charging and rules["hold_battery_while_ev_grid_charging"]:
                mode, rt["status"] = "hold", "ev_hold"
            if mode == "charge" and rules.get("max_total_amps") and rules["grid_priority"] == "ev":
                battery_amps = cfg["max_charge_kw"] * 1000 / (GRID_VOLTAGE * 3)
                if ctx.ev_amps_total + battery_amps > rules["max_total_amps"]:
                    mode, rt["status"] = "hold", "fuse_wait"
        rt["mode"] = mode
        try:
            await self._apply(cfg, mode)
        except HomeAssistantError as err:
            rt["last_action"] = {"at": ctx.now.isoformat(), "mode": mode, "ok": False, "error": str(err)}
            _LOGGER.warning("Battery: could not switch to %s: %s", mode, err)

    async def _run(self, cfg: dict[str, Any], mode: str, action: str) -> bool:
        start = cfg[f"{mode}_start_entity"]
        if not start:
            return False
        if action == "start":
            await async_run_command(self.hass, start, cfg[f"{mode}_start_value"] or None)
        else:
            await async_run_command(
                self.hass,
                cfg[f"{mode}_stop_entity"],
                cfg[f"{mode}_stop_value"] or None,
                is_stop=True,
                start_entity=start,
            )
        return True

    async def _apply(self, cfg: dict[str, Any], mode: str) -> None:
        if self._active == mode:
            return
        sent: list[str] = []
        # Stop the previous mode first (both modes on first run, since the inverter state is unknown).
        for old in ("charge", "hold") if self._active is None else (self._active,):
            if old in ("charge", "hold") and old != mode and await self._run(cfg, old, "stop"):
                sent.append(f"{old}:stop")
        if mode in ("charge", "hold") and await self._run(cfg, mode, "start"):
            sent.append(f"{mode}:start")
        self._active = mode
        self.runtime["last_action"] = {
            "at": dt_util.now().isoformat(),
            "mode": mode,
            "ok": True,
            "sent": sent,
        }
        if sent:
            _LOGGER.info("Battery: switched to %s (%s)", mode, ", ".join(sent))

    def reset(self) -> None:
        """Forget the last commanded mode (after config changes)."""
        self._active = None
