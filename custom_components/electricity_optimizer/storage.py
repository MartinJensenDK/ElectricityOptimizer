"""Persistent storage of cars."""

from __future__ import annotations

import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    BATTERY_DEFAULTS,
    BATTERY_MODES,
    CAR_DEFAULTS,
    STORAGE_KEY_BATTERY,
    STORAGE_KEY_CARS,
    STORAGE_VERSION,
)

NUMERIC_FIELDS = {
    "capacity_kwh": float,
    "charge_power_kw": float,
    "target_soc": int,
}


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
    car["enabled"] = bool(car["enabled"])
    car["charge_now"] = bool(car["charge_now"])
    car["target_soc"] = max(1, min(100, car["target_soc"]))
    for key in ("name", "soc_entity", "start_entity", "start_value", "stop_entity", "stop_value", "plugged_entity", "ready_by"):
        car[key] = str(car[key] or "").strip()
    if len(car["ready_by"]) == 8:  # HH:MM:SS -> HH:MM
        car["ready_by"] = car["ready_by"][:5]
    car["id"] = (existing or {}).get("id") or raw.get("id") or uuid.uuid4().hex[:8]
    return car


def validate_car(car: dict[str, Any]) -> str | None:
    """Return an error code or None."""
    if not car["name"]:
        return "name_required"
    if not car["soc_entity"]:
        return "soc_required"
    if not car["start_entity"] or not car["stop_entity"]:
        return "start_stop_required"
    if car["capacity_kwh"] <= 0 or car["charge_power_kw"] <= 0:
        return "capacity_power_positive"
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
    return cfg


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
