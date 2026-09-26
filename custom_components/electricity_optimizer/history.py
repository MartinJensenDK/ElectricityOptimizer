"""Charging history: what was charged when, what it cost and what it saved."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, GRID_VOLTAGE, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY_HISTORY = f"{DOMAIN}.history"
HISTORY_MAX_ENTRIES = 500
COMMANDS_MAX = 300
HISTORY_MAX_DAYS = 90
MAX_STEP_SECONDS = 180  # ignore gaps longer than this (restart, HA paused)
STALE_OPEN_SECONDS = 600  # an open session not updated for this long is closed at its last tick
SAVE_INTERVAL_SECONDS = 300


def _round(v: float, digits: int = 3) -> float:
    return round(v + 0.0, digits)


class HistoryStore:
    """Persisted closed sessions plus the sessions currently open."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_HISTORY)
        self.entries: list[dict[str, Any]] = []
        self.open: dict[str, dict[str, Any]] = {}
        self.commands: list[dict[str, Any]] = []
        self.dirty = False
        self._last_save: datetime | None = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.entries = list(data.get("entries") or [])
        self.open = dict(data.get("open") or {})
        self.commands = list(data.get("commands") or [])[-COMMANDS_MAX:]
        now = dt_util.now()
        for key in list(self.open):
            session = self.open[key]
            last = _dt(session.get("last"))
            if last is None or (now - last).total_seconds() > STALE_OPEN_SECONDS:
                self.close(key, last or now, save=False)
        self.prune(now)

    async def async_save(self) -> None:
        await self._store.async_save({"entries": self.entries, "open": self.open, "commands": self.commands})
        self._last_save = dt_util.now()
        self.dirty = False

    def add_command(self, entry: dict[str, Any]) -> None:
        entry = {"at": dt_util.now().isoformat(), **entry}
        self.commands.append(entry)
        if len(self.commands) > COMMANDS_MAX:
            del self.commands[: len(self.commands) - COMMANDS_MAX]
        self.dirty = True

    def prune(self, now: datetime) -> None:
        cutoff = (now - timedelta(days=HISTORY_MAX_DAYS)).isoformat()
        self.entries = [e for e in self.entries if e.get("end", "") >= cutoff][-HISTORY_MAX_ENTRIES:]

    def close(self, key: str, end: datetime, *, save: bool = True) -> dict[str, Any] | None:
        session = self.open.pop(key, None)
        if session is None:
            return None
        session["end"] = end.isoformat()
        session.pop("last", None)
        session["kwh"] = _round(session["kwh"])
        session["solar_kwh"] = _round(session["solar_kwh"])
        session["cost"] = _round(session["cost"], 2)
        session["saved"] = _round(session["saved"], 2)
        if session["kwh"] + session["solar_kwh"] >= 0.05:
            self.entries.append(session)
        return session

    def needs_save(self, now: datetime) -> bool:
        return self._last_save is None or (now - self._last_save).total_seconds() >= SAVE_INTERVAL_SECONDS


def _dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


class HistoryTracker:
    """Accumulates energy and cost for running EV/battery charging sessions on every evaluation."""

    def __init__(self, hass: HomeAssistant, store: HistoryStore) -> None:
        self.hass = hass
        self.store = store

    @staticmethod
    def _price_now(ctx: Any) -> float | None:
        for slot in ctx.slots:
            if slot.start <= ctx.now < slot.end:
                return slot.price
        return None

    @staticmethod
    def _day_mean(ctx: Any) -> float | None:
        today = [s.price for s in ctx.slots if s.start.date() == ctx.now.date() and not s.estimated]
        return sum(today) / len(today) if today else None

    def _touch(self, key: str, ctx: Any, *, kind: str, name: str, source: str, power_w: float, soc: float | None, item_id: str | None = None) -> None:
        now = ctx.now
        session = self.store.open.get(key)
        if session is not None and session.get("source") != source:
            self.store.close(key, now)
            session = None
        if session is None:
            session = {
                "kind": kind,
                "id": item_id,
                "name": name,
                "source": source,
                "start": now.isoformat(),
                "last": now.isoformat(),
                "soc_start": soc,
                "soc_end": soc,
                "kwh": 0.0,  # from the grid
                "solar_kwh": 0.0,
                "cost": 0.0,
                "saved": 0.0,
                "price_kwh": 0.0,  # sum(price * kWh) for the average
            }
            self.store.open[key] = session
            return
        last = _dt(session.get("last")) or now
        step = (now - last).total_seconds()
        session["last"] = now.isoformat()
        session["soc_end"] = soc
        if step <= 0 or step > MAX_STEP_SECONDS or power_w <= 0:
            return
        kwh = power_w * step / 3600 / 1000
        price = self._price_now(ctx)
        mean = self._day_mean(ctx)
        if source == "solar":
            session["solar_kwh"] += kwh
            if price is not None:
                session["saved"] += kwh * price  # what the same energy would have cost from the grid
        else:
            session["kwh"] += kwh
            if price is not None:
                session["cost"] += kwh * price
                session["price_kwh"] += kwh * price
                if mean is not None:
                    session["saved"] += kwh * (mean - price)  # vs. charging at today's average price

    def update(self, ctx: Any, cars: list[dict[str, Any]], car_runtime: dict[str, dict[str, Any]], battery_cfg: dict[str, Any] | None, battery_runtime: dict[str, Any]) -> None:
        now = ctx.now
        seen: set[str] = set()
        for car in cars:
            rt = car_runtime.get(car["id"]) or {}
            key = f"ev:{car['id']}"
            if rt.get("charging") and rt.get("mode"):
                seen.add(key)
                car_w = rt.get("car_w")
                amps = rt.get("amps") or car["max_amps"]
                power_w = car_w if car_w and car_w > 0 else amps * GRID_VOLTAGE * car["phases"]
                self._touch(key, ctx, kind="ev", item_id=car["id"], name=car["name"], source=rt["mode"], power_w=power_w, soc=rt.get("soc"))
        if battery_cfg is not None and battery_runtime.get("mode") == "charge":
            seen.add("battery")
            power_w = ctx.battery_w if ctx.battery_w and ctx.battery_w > 0 else battery_cfg["max_charge_kw"] * 1000
            self._touch("battery", ctx, kind="battery", name="Husbatteri", source="grid", power_w=power_w, soc=ctx.battery_soc)
        for key in list(self.store.open):
            if key not in seen:
                self.store.close(key, now)
        self.store.prune(now)

    async def async_update(self, ctx: Any, cars: list[dict[str, Any]], car_runtime: dict[str, dict[str, Any]], battery_cfg: dict[str, Any] | None, battery_runtime: dict[str, Any]) -> None:
        before = len(self.store.entries)
        self.update(ctx, cars, car_runtime, battery_cfg, battery_runtime)
        if len(self.store.entries) != before or self.store.dirty or self.store.needs_save(ctx.now):
            await self.store.async_save()

    def log_command(self, entry: dict[str, Any]) -> None:
        """Called from commands.py for every command sent (ok or failed)."""
        self.store.add_command(entry)

    def snapshot(self) -> dict[str, Any]:
        """For the panel: closed sessions newest first, plus running ones."""
        running = []
        for session in self.store.open.values():
            s = dict(session)
            s["running"] = True
            for k in ("kwh", "solar_kwh"):
                s[k] = _round(s[k])
            for k in ("cost", "saved"):
                s[k] = _round(s[k], 2)
            running.append(s)
        return {"entries": list(reversed(self.store.entries)), "open": running, "commands": list(reversed(self.store.commands[-200:]))}
