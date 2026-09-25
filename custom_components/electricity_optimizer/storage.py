"""Persistent storage of cars."""

from __future__ import annotations

import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    GRID_VOLTAGE,
    BATTERY_DEFAULTS,
    RULES_DEFAULTS,
    STORAGE_KEY_RULES,
    BATTERY_MODES,
    CAR_DEFAULTS,
    STORAGE_KEY_BATTERY,
    STORAGE_KEY_CARS,
    STORAGE_VERSION,
)

NUMERIC_FIELDS = {
    "capacity_kwh": float,
    "charge_power_kw": float,
    "min_amps": int,
    "max_amps": int,
    "phases": int,
    "target_soc": int,
}


def amps_to_kw(amps: float, phases: int) -> float:
    return round(amps * GRID_VOLTAGE * phases / 1000, 2)


def normalize_car(raw: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge raw input onto existing car (or defaults) and coerce types."""
    car: dict[str, Any] = {**CAR_DEFAULTS, **(existing or {})}
    for key in CAR_DEFAULTS:
        if key in raw:
            car[key] = raw[key]
    for key, cast in NUMERIC_FIELDS.items():
        try:
            car[key] = cast(car[key])
        except (TypeError, ValueError):
            car[key] = CAR_DEFAULTS[key]
    if car["price_limit"] in ("", None):
        car["price_limit"] = None
    else:
        try:
            car["price_limit"] = float(car["price_limit"])
        except (TypeError, ValueError):
            car["price_limit"] = None
    car["phases"] = 3 if car["phases"] not in (1, 2, 3) else car["phases"]
    legacy = {**(existing or {}), **raw}
    if "max_amps" not in legacy:
        # migrate: charge_amps (v0.5) or charge_power_kw (v0.3/0.4)
        if "charge_amps" in legacy:
            car["max_amps"] = int(float(legacy["charge_amps"]))
        else:
            car["max_amps"] = round(car["charge_power_kw"] * 1000 / (GRID_VOLTAGE * car["phases"]))
    car["min_amps"] = max(1, min(car["min_amps"], car["max_amps"]))
    car["max_amps"] = max(car["min_amps"], car["max_amps"])
    if car["source"] not in ("solar", "solar_plan", "plan"):
        car["source"] = "solar_plan"
    car["charge_power_kw"] = amps_to_kw(car["max_amps"], car["phases"])
    car["enabled"] = bool(car["enabled"])
    car["charge_now"] = bool(car["charge_now"])
    car["target_soc"] = max(1, min(100, car["target_soc"]))
    for key in ("name", "soc_entity", "start_entity", "start_value", "stop_entity", "stop_value", "plugged_entity", "current_entity", "power_entity", "source", "ready_by"):
        car[key] = str(car[key] or "").strip()
    if len(car["ready_by"]) == 8:  # HH:MM:SS -> HH:MM
        car["ready_by"] = car["ready_by"][:5]
    if len(car["ready_by"]) == 8:
        car["ready_by"] = car["ready_by"][:5]
    if not _valid_time(car["ready_by"]):
        car["ready_by"] = CAR_DEFAULTS["ready_by"]
    car["schedule"] = normalize_schedule(car.get("schedule"), car["ready_by"], car["target_soc"])
    car["id"] = (existing or {}).get("id") or raw.get("id") or uuid.uuid4().hex[:8]
    return car


def _valid_time(value: Any) -> bool:
    parts = str(value).split(":")
    return len(parts) == 2 and all(p.isdigit() for p in parts) and int(parts[0]) < 24 and int(parts[1]) < 60


def normalize_schedule(raw: Any, default_ready_by: str, default_target: int) -> list[dict[str, Any]]:
    """Return exactly 7 entries (Mon..Sun), filling gaps from the car defaults."""
    out: list[dict[str, Any]] = []
    items = raw if isinstance(raw, list) else []
    for i in range(7):
        item = items[i] if i < len(items) and isinstance(items[i], dict) else {}
        ready_by = str(item.get("ready_by") or default_ready_by).strip()
        if len(ready_by) == 8:
            ready_by = ready_by[:5]
        if not _valid_time(ready_by):
            ready_by = default_ready_by
        try:
            target = int(float(item.get("target_soc", default_target)))
        except (TypeError, ValueError):
            target = default_target
        out.append({
            "enabled": bool(item.get("enabled", True)),
            "ready_by": ready_by,
            "target_soc": max(1, min(100, target)),
        })
    return out


def validate_car(car: dict[str, Any]) -> str | None:
    """Return an error code or None."""
    if not car["name"]:
        return "name_required"
    if not car["soc_entity"]:
        return "soc_required"
    if not car["start_entity"] or not car["stop_entity"]:
        return "start_stop_required"
    if car["capacity_kwh"] <= 0 or car["max_amps"] <= 0:
        return "capacity_power_positive"
    if car["current_entity"] and car["current_entity"].split(".")[0] not in ("number", "input_number"):
        return "current_entity_number"
    parts = car["ready_by"].split(":")
    if len(parts) != 2 or not all(p.isdigit() for p in parts) or int(parts[0]) > 23 or int(parts[1]) > 59:
        return "ready_by_invalid"
    return None


class CarStore:
    """Load/save the list of cars."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_CARS)
        self.cars: list[dict[str, Any]] = []

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.cars = [normalize_car(c) for c in data.get("cars", [])]

    async def async_save(self) -> None:
        await self._store.async_save({"cars": self.cars})

    def get(self, car_id: str) -> dict[str, Any] | None:
        return next((c for c in self.cars if c["id"] == car_id), None)

    async def async_upsert(self, raw: dict[str, Any]) -> dict[str, Any]:
        existing = self.get(raw["id"]) if raw.get("id") else None
        car = normalize_car(raw, existing)
        if existing:
            existing.update(car)
            car = existing
        else:
            self.cars.append(car)
        await self.async_save()
        return car

    async def async_move(self, car_id: str, direction: str) -> bool:
        idx = next((i for i, c in enumerate(self.cars) if c["id"] == car_id), None)
        if idx is None:
            return False
        new = idx - 1 if direction == "up" else idx + 1
        if new < 0 or new >= len(self.cars):
            return False
        self.cars[idx], self.cars[new] = self.cars[new], self.cars[idx]
        await self.async_save()
        return True

    async def async_delete(self, car_id: str) -> bool:
        before = len(self.cars)
        self.cars = [c for c in self.cars if c["id"] != car_id]
        if len(self.cars) != before:
            await self.async_save()
            return True
        return False


BATTERY_NUMERIC = {
    "capacity_kwh": float,
    "max_charge_kw": float,
    "max_discharge_kw": float,
    "min_soc": int,
    "max_soc": int,
    "spread_threshold": float,
    "efficiency": float,
}


def normalize_battery(raw: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge raw input onto existing battery config and coerce types."""
    cfg: dict[str, Any] = {**BATTERY_DEFAULTS, **(existing or {})}
    for key in BATTERY_DEFAULTS:
        if key in raw:
            cfg[key] = raw[key]
    for key, cast in BATTERY_NUMERIC.items():
        try:
            cfg[key] = cast(float(str(cfg[key]).replace(",", ".")))
        except (TypeError, ValueError):
            cfg[key] = BATTERY_DEFAULTS[key]
    for key, value in BATTERY_DEFAULTS.items():
        if isinstance(value, str):
            cfg[key] = str(cfg[key] or "").strip()
    cfg["enabled"] = bool(cfg["enabled"])
    cfg["grid_charge_enabled"] = bool(cfg["grid_charge_enabled"])
    cfg["min_soc"] = max(0, min(100, cfg["min_soc"]))
    cfg["max_soc"] = max(cfg["min_soc"], min(100, cfg["max_soc"]))
    cfg["efficiency"] = max(0.5, min(1.0, cfg["efficiency"]))
    if cfg["power_sign"] not in ("charge_positive", "discharge_positive"):
        cfg["power_sign"] = "charge_positive"
    if cfg["grid_sign"] not in ("import_positive", "export_positive"):
        cfg["grid_sign"] = "import_positive"
    if cfg["override"] not in ("auto", *BATTERY_MODES):
        cfg["override"] = "auto"
    cfg["schedule"] = normalize_battery_schedule(cfg.get("schedule"), cfg["grid_charge_enabled"])
    # keep the legacy flag in sync: "any day may charge from grid"
    cfg["grid_charge_enabled"] = any(d["grid_charge"] for d in cfg["schedule"])
    return cfg


def normalize_battery_schedule(raw: Any, grid_default: bool) -> list[dict[str, Any]]:
    """Return exactly 7 entries (Mon..Sun) for the battery."""
    out: list[dict[str, Any]] = []
    items = raw if isinstance(raw, list) else []
    for i in range(7):
        item = items[i] if i < len(items) and isinstance(items[i], dict) else {}
        ready_by = str(item.get("ready_by") or "17:00").strip()
        if len(ready_by) == 8:
            ready_by = ready_by[:5]
        if not _valid_time(ready_by):
            ready_by = "17:00"
        target: int | None
        raw_target = item.get("target_soc")
        if raw_target in (None, "", "null"):
            target = None
        else:
            try:
                target = max(1, min(100, int(float(raw_target))))
            except (TypeError, ValueError):
                target = None
        out.append({
            "enabled": bool(item.get("enabled", True)),
            "grid_charge": bool(item.get("grid_charge", grid_default)),
            "ready_by": ready_by,
            "target_soc": target,
        })
    return out


def validate_battery(cfg: dict[str, Any]) -> str | None:
    """Return an error code or None."""
    if not cfg["soc_entity"]:
        return "soc_required"
    if cfg["capacity_kwh"] <= 0 or cfg["max_charge_kw"] <= 0 or cfg["max_discharge_kw"] <= 0:
        return "capacity_power_positive"
    for mode in ("charge", "hold"):
        start, stop = cfg[f"{mode}_start_entity"], cfg[f"{mode}_stop_entity"]
        if bool(start) != bool(stop):
            return f"{mode}_start_stop_both"
    return None


class BatteryStore:
    """Load/save the single house battery configuration."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_BATTERY)
        self.battery: dict[str, Any] | None = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.battery = normalize_battery(data["battery"]) if data.get("battery") else None

    async def async_save(self) -> None:
        await self._store.async_save({"battery": self.battery})

    async def async_update(self, raw: dict[str, Any]) -> dict[str, Any]:
        self.battery = normalize_battery(raw, self.battery)
        await self.async_save()
        return self.battery

    async def async_delete(self) -> None:
        self.battery = None
        await self.async_save()


RULES_NUMERIC = {
    "battery_min_soc_for_ev_solar": int,
    "solar_start_minutes": float,
    "solar_stop_minutes": float,
}


def normalize_rules(raw: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    rules: dict[str, Any] = {**RULES_DEFAULTS, **(existing or {})}
    for key in RULES_DEFAULTS:
        if key in raw:
            rules[key] = raw[key]
    for key, cast in RULES_NUMERIC.items():
        try:
            rules[key] = cast(float(str(rules[key]).replace(",", ".")))
        except (TypeError, ValueError):
            rules[key] = RULES_DEFAULTS[key]
    if rules["max_total_amps"] in ("", None):
        rules["max_total_amps"] = None
    else:
        try:
            rules["max_total_amps"] = float(str(rules["max_total_amps"]).replace(",", "."))
        except (TypeError, ValueError):
            rules["max_total_amps"] = None
    rules["hold_battery_while_ev_grid_charging"] = bool(rules["hold_battery_while_ev_grid_charging"])
    rules["battery_min_soc_for_ev_solar"] = max(0, min(100, rules["battery_min_soc_for_ev_solar"]))
    rules["solar_start_minutes"] = max(0.0, rules["solar_start_minutes"])
    rules["solar_stop_minutes"] = max(0.0, rules["solar_stop_minutes"])
    if rules["solar_priority"] not in ("ev", "battery"):
        rules["solar_priority"] = "ev"
    if rules["grid_priority"] not in ("ev", "battery"):
        rules["grid_priority"] = "ev"
    if rules["grid_sign"] not in ("import_positive", "export_positive"):
        rules["grid_sign"] = "import_positive"
    rules["grid_power_entity"] = str(rules["grid_power_entity"] or "").strip()
    return rules


class RulesStore:
    """Load/save the shared rules."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_RULES)
        self.rules: dict[str, Any] = dict(RULES_DEFAULTS)

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.rules = normalize_rules(data.get("rules") or {})

    async def async_update(self, raw: dict[str, Any]) -> dict[str, Any]:
        self.rules = normalize_rules(raw, self.rules)
        await self._store.async_save({"rules": self.rules})
        return self.rules
