"""Persisted controller state so a Home Assistant restart does not interrupt charging.

Without this the controllers start with an unknown charger state and send stop/start
to resync, which interrupts an EV that was happily charging.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_VERSION

STORAGE_KEY_RUNTIME = f"{DOMAIN}.runtime"
SAVE_DELAY_S = 2


class RuntimeStateStore:
    """Small key/value store: per-car charging state and the battery's last commanded mode."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_RUNTIME)
        self.data: dict[str, Any] = {"ev": {}, "battery": {}}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.data = {"ev": dict(data.get("ev") or {}), "battery": dict(data.get("battery") or {})}

    def save(self) -> None:
        """Debounced write (called after every command)."""
        self._store.async_delay_save(lambda: self.data, SAVE_DELAY_S)

    async def async_save(self) -> None:
        await self._store.async_save(self.data)
