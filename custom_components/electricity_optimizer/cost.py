"""Average price of the energy stored in the house battery and the cars, and the battery's efficiency.

Every evaluation the energy going into a battery is split into what comes from the grid (at the
current price), from the house battery's discharge (at the house battery's own average price) and
from the sun (at the configured value of solar power, 0 by default). When the state of charge
rises, the energy that was added is blended into the average price of what was already stored:

    avg = (stored * avg + added * price_of_added) / (stored + added)

Discharging removes energy at the average price, so the average itself is unchanged by it.
The price is per kWh sent to the battery; charging losses are shown separately as the efficiency.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .const import GRID_VOLTAGE

MAX_STEP_SECONDS = 180  # ignore gaps longer than this (restart, HA paused)
MAX_SENSOR_STEP_KWH = 10.0  # an energy sensor jumping more than this in one step is a reset or a glitch
CHARGING_W = 30  # below this a battery is not really charging or discharging
EFFICIENCY_MIN_KWH = 3.0  # measured energy needed in a direction before its efficiency is shown


def _dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def price_now(ctx: Any) -> float | None:
    for slot in ctx.slots:
        if slot.start <= ctx.now < slot.end:
            return slot.price
    return None


class CostTracker:
    """Keeps the average price per pool ("battery", "ev:<id>") in a plain dict that is persisted."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        self.data: dict[str, Any] = data if data is not None else {}
        self.dirty = False

    # ---- pools ---------------------------------------------------------------------------------

    def _pool(self, key: str) -> dict[str, Any]:
        pool = self.data.setdefault("pools", {}).setdefault(key, {})
        for k, default in (("avg", None), ("solar_share", None), ("last_soc", None), ("pend_kwh", 0.0), ("pend_cost", 0.0), ("pend_solar", 0.0)):
            pool.setdefault(k, default)
        return pool

    def average(self, key: str) -> float | None:
        return (self.data.get("pools", {}).get(key) or {}).get("avg")

    def snapshot(self, key: str) -> dict[str, Any] | None:
        pool = self.data.get("pools", {}).get(key)
        if not pool or pool.get("avg") is None:
            return None
        return {"avg": round(pool["avg"], 4), "solar_share": None if pool.get("solar_share") is None else round(pool["solar_share"], 3)}

    def reset(self, key: str) -> None:
        self.data.get("pools", {}).pop(key, None)
        self.dirty = True

    def _feed(self, pool: dict[str, Any], kwh: float, unit_price: float, solar_kwh: float) -> None:
        pool["pend_kwh"] += kwh
        pool["pend_cost"] += kwh * unit_price
        pool["pend_solar"] += solar_kwh

    def _soc_step(self, pool: dict[str, Any], soc: float | None, capacity_kwh: float, fallback: tuple[float, float] | None) -> float:
        """Blend a rise in SoC into the average; returns the change in stored kWh (+ up, − down)."""
        last = pool["last_soc"]
        if soc is None:
            return 0.0
        pool["last_soc"] = soc
        if last is None or soc == last:
            return 0.0
        self.dirty = True
        delta = (soc - last) / 100 * capacity_kwh
        if delta < 0:
            return delta
        if pool["pend_kwh"] > 0:
            unit, solar = pool["pend_cost"] / pool["pend_kwh"], pool["pend_solar"] / pool["pend_kwh"]
        elif fallback is not None:
            unit, solar = fallback
        else:
            return delta  # charged somewhere we cannot see (e.g. a public charger): the average is kept
        pool["pend_kwh"] = pool["pend_cost"] = pool["pend_solar"] = 0.0
        before = max(0.0, last / 100 * capacity_kwh)
        if pool["avg"] is None or before <= 0:
            pool["avg"], pool["solar_share"] = unit, solar
        else:
            pool["avg"] = (before * pool["avg"] + delta * unit) / (before + delta)
            pool["solar_share"] = (before * (pool["solar_share"] or 0.0) + delta * solar) / (before + delta)
        return delta

    # ---- efficiency ----------------------------------------------------------------------------

    def _eff(self) -> dict[str, Any]:
        eff = self.data.setdefault("efficiency", {})
        for k in ("in_kwh", "stored_kwh", "out_kwh", "drawn_kwh"):
            eff.setdefault(k, 0.0)
        return eff

    def reset_efficiency(self) -> None:
        self.data["efficiency"] = {}
        self.dirty = True

    def _sensor_delta(self, eff: dict[str, Any], key: str, value: float | None) -> float | None:
        """kWh added on an energy sensor since the last reading (None when there is no sensor)."""
        if value is None:
            eff.pop(key, None)
            return None
        last = eff.get(key)
        eff[key] = value
        if last is None or value < last or value - last > MAX_SENSOR_STEP_KWH:
            return 0.0  # first reading, midnight reset or a glitch
        return value - last

    def efficiency_snapshot(self) -> dict[str, Any]:
        eff = self._eff()
        charge = eff["stored_kwh"] / eff["in_kwh"] if eff["in_kwh"] >= EFFICIENCY_MIN_KWH and eff["stored_kwh"] > 0 else None
        discharge = eff["out_kwh"] / eff["drawn_kwh"] if eff["drawn_kwh"] >= EFFICIENCY_MIN_KWH and eff["out_kwh"] > 0 else None
        return {
            "in_kwh": round(eff["in_kwh"], 2),
            "stored_kwh": round(eff["stored_kwh"], 2),
            "out_kwh": round(eff["out_kwh"], 2),
            "drawn_kwh": round(eff["drawn_kwh"], 2),
            "charge": None if charge is None else round(charge, 3),
            "discharge": None if discharge is None else round(discharge, 3),
            "round_trip": None if charge is None or discharge is None else round(charge * discharge, 3),
            "min_kwh": EFFICIENCY_MIN_KWH,
            "since": eff.get("since"),
            "measurable": bool(eff.get("measurable")),
        }

    # ---- one evaluation ------------------------------------------------------------------------

    def update(
        self,
        ctx: Any,
        cars: list[dict[str, Any]],
        car_runtime: dict[str, dict[str, Any]],
        battery_cfg: dict[str, Any] | None,
        battery_runtime: dict[str, Any],
        *,
        charged_kwh: float | None = None,
        discharged_kwh: float | None = None,
    ) -> None:
        now = ctx.now
        last = _dt(self.data.get("last"))
        self.data["last"] = now.isoformat()
        step = (now - last).total_seconds() if last is not None else 0.0
        hours = step / 3600 if 0 < step <= MAX_STEP_SECONDS else 0.0
        price = price_now(ctx)
        solar_value = float(ctx.rules.get("solar_value_per_kwh") or 0.0)

        battery_w = ctx.battery_w if battery_cfg is not None else None
        bat_charge_w = max(0.0, battery_w or 0.0)
        bat_discharge_w = max(0.0, -(battery_w or 0.0))
        car_w: dict[str, float] = {}
        for car in cars:
            rt = car_runtime.get(car["id"]) or {}
            if not rt.get("charging"):
                continue
            w = rt.get("car_w")
            if w is None:
                w = (rt.get("amps") or car["max_amps"]) * GRID_VOLTAGE * car["phases"]
            if w > CHARGING_W:
                car_w[car["id"]] = w
        load_w = (bat_charge_w if bat_charge_w > CHARGING_W else 0.0) + sum(car_w.values())
        # the grid's share of what the batteries are taking: solar covers the house first, then the batteries
        grid_share = None
        if ctx.grid_w is not None and load_w > 0:
            grid_share = max(0.0, min(1.0, ctx.grid_w / load_w))
        battery_avg = self.average("battery")

        def unit_price(share: float, from_battery: float = 0.0) -> tuple[float, float] | None:
            """(price per kWh, solar share) for a mix of grid, house battery and sun."""
            if price is None:
                return None
            solar = max(0.0, 1.0 - share - from_battery)
            battery_price = battery_avg if battery_avg is not None else solar_value
            return share * price + from_battery * battery_price + solar * solar_value, solar

        # house battery
        if battery_cfg is None:
            if "battery" in self.data.get("pools", {}):
                self.reset("battery")
        else:
            pool = self._pool("battery")
            share = grid_share if grid_share is not None else (1.0 if battery_runtime.get("mode") == "charge" else 0.0)
            mix = unit_price(share)
            if bat_charge_w > CHARGING_W and hours and mix is not None:
                kwh = bat_charge_w * hours / 1000
                self._feed(pool, kwh, mix[0], kwh * mix[1])
            change = self._soc_step(pool, ctx.battery_soc, float(battery_cfg["capacity_kwh"]), mix if bat_charge_w > CHARGING_W or battery_w is None else None)
            self._update_efficiency(now, battery_w, hours, change, charged_kwh, discharged_kwh)

        # cars
        known = {f"ev:{car['id']}" for car in cars}
        for key in [k for k in self.data.get("pools", {}) if k.startswith("ev:") and k not in known]:
            self.reset(key)
        for car in cars:
            rt = car_runtime.get(car["id"]) or {}
            pool = self._pool(f"ev:{car['id']}")
            w = car_w.get(car["id"])
            mix = None
            if w is not None:
                if grid_share is not None:
                    # what is not from the grid comes from the house battery's discharge first, then from the sun
                    from_battery = min(1.0 - grid_share, bat_discharge_w / load_w) if bat_discharge_w > CHARGING_W else 0.0
                    mix = unit_price(grid_share, from_battery)
                else:
                    mix = unit_price(0.0 if rt.get("mode") == "solar" else 1.0)
                if hours and mix is not None:
                    kwh = w * hours / 1000
                    self._feed(pool, kwh, mix[0], kwh * mix[1])
            self._soc_step(pool, rt.get("soc"), float(car["capacity_kwh"]), mix)

    def _update_efficiency(self, now: datetime, battery_w: float | None, hours: float, soc_change_kwh: float, charged_kwh: float | None, discharged_kwh: float | None) -> None:
        eff = self._eff()
        d_in = self._sensor_delta(eff, "last_charged", charged_kwh)
        d_out = self._sensor_delta(eff, "last_discharged", discharged_kwh)
        if d_in is None:
            d_in = max(0.0, battery_w) * hours / 1000 if battery_w is not None else None
        if d_out is None:
            d_out = max(0.0, -battery_w) * hours / 1000 if battery_w is not None else None
        eff["measurable"] = d_in is not None and d_out is not None
        if d_in is None or d_out is None:
            return
        eff.setdefault("since", now.isoformat())
        if d_in or d_out or soc_change_kwh:
            self.dirty = True
        eff["in_kwh"] += d_in
        eff["out_kwh"] += d_out
        if soc_change_kwh > 0:
            eff["stored_kwh"] += soc_change_kwh
        else:
            eff["drawn_kwh"] += -soc_change_kwh
