"""Plans and controls the house battery: normal / hold / charge from grid."""

from __future__ import annotations

from datetime import datetime
import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .commands import async_run_command
from .ev_controller import Slot, read_price_slots
from .storage import BatteryStore

_LOGGER = logging.getLogger(__name__)


def plan_battery(now: datetime, slots: list[Slot], soc: float, cfg: dict[str, Any]) -> dict[str, Any] | None:
    """Assign a mode to every known future slot.

    hold:   price below the day's mean and a later slot is at least `spread_threshold` dearer.
    charge: grid charging enabled, room in the battery, and the cheapest slots whose price is at least
            `spread_threshold` below the (efficiency-adjusted) average of the dearest later slots.
    normal: everything else.
    """
    candidates = [s for s in slots if s.end > now]
    if not candidates:
        return None
    thr = cfg["spread_threshold"]
    eff = cfg["efficiency"]

    by_day: dict[Any, list[float]] = {}
    for s in slots:
        by_day.setdefault(s.start.date(), []).append(s.price)
    day_mean = {d: sum(v) / len(v) for d, v in by_day.items()}

    modes: dict[datetime, str] = {}
    for i, s in enumerate(candidates):
        later = candidates[i + 1 :]
        if not later:
            continue
        later_max = max(x.price for x in later)
        if s.price < day_mean[s.start.date()] and later_max - s.price >= thr:
            modes[s.start] = "hold"

    charge_hours = 0.0
    if cfg["grid_charge_enabled"] and soc < cfg["max_soc"]:
        room_kwh = (cfg["max_soc"] - soc) / 100 * cfg["capacity_kwh"]
        charge_hours = room_kwh / cfg["max_charge_kw"]
        slot_hours = candidates[0].hours or 1.0
        n_expensive = max(1, math.ceil(charge_hours / slot_hours))
        remaining = charge_hours
        for s in sorted(candidates, key=lambda s: (s.price, s.start)):
            if remaining <= 0:
                break
            later = [x for x in candidates if x.start > s.start]
            if not later:
                continue
            dearest = sorted((x.price for x in later), reverse=True)[:n_expensive]
            if (sum(dearest) / len(dearest)) * eff - s.price >= thr:
                modes[s.start] = "charge"
                avail_start = max(s.start, now)
                remaining -= (s.end - avail_start).total_seconds() / 3600

    current = next((s for s in candidates if s.start <= now < s.end), None)
    auto_mode = modes.get(current.start, "normal") if current else "normal"
    later_max = max((s.price for s in candidates if current and s.start > current.start), default=None)
    return {
        "auto_mode": auto_mode,
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

    async def async_evaluate(self) -> None:
        cfg = self.store.battery
        if cfg is None:
            self.runtime = {}
            return
        now = dt_util.now()
        rt = self.runtime
        rt["evaluated_at"] = now.isoformat()
        soc = self._number(cfg["soc_entity"])
        rt["soc"] = soc
        rt["commands_configured"] = {
            "charge": bool(cfg["charge_start_entity"]),
            "hold": bool(cfg["hold_start_entity"]),
        }
        if soc is None:
            rt["status"] = "no_soc"
            rt["plan"] = None
            return
        slots = read_price_slots(self.hass, self.price_entity)
        plan = plan_battery(now, slots, soc, cfg) if slots else None
        rt["plan"] = plan
        if plan is None:
            rt["status"] = "no_prices"
            rt["mode"] = "normal"
            return

        if not cfg["enabled"]:
            rt["status"] = "disabled"
            rt["mode"] = "normal"
            return

        if cfg["override"] != "auto":
            mode = cfg["override"]
            rt["status"] = "override"
        else:
            mode = plan["auto_mode"]
            rt["status"] = "auto"
        if mode == "charge" and soc >= cfg["max_soc"]:
            mode = "normal"
            rt["status"] = "full"
        rt["mode"] = mode
        try:
            await self._apply(cfg, mode)
        except HomeAssistantError as err:
            rt["last_action"] = {"at": now.isoformat(), "mode": mode, "ok": False, "error": str(err)}
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
