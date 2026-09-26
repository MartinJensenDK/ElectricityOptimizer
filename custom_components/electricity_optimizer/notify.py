"""Persistent notifications and events for things the user should know about."""

from __future__ import annotations

import logging
import re

from homeassistant.components import persistent_notification
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

EVENT_NOTIFICATION = f"{DOMAIN}_notification"


class Notifier:
    """Deduplicated notifications: each key is sent once until cleared."""

    def __init__(self, hass: HomeAssistant, rules_store) -> None:
        self.hass = hass
        self._rules_store = rules_store
        self._sent: set[str] = set()

    @property
    def enabled(self) -> bool:
        return bool(self._rules_store.rules.get("notify_enabled", True))

    @staticmethod
    def _notification_id(key: str) -> str:
        return f"{DOMAIN}_{re.sub(r'[^a-z0-9]+', '_', key.lower())}"

    def notify(self, key: str, title: str, message: str) -> bool:
        if key in self._sent:
            return False
        self._sent.add(key)
        self.hass.bus.async_fire(EVENT_NOTIFICATION, {"key": key, "title": title, "message": message})
        if not self.enabled:
            return False
        persistent_notification.async_create(self.hass, message, title=title, notification_id=self._notification_id(key))
        _LOGGER.info("Notification: %s - %s", title, message)
        return True

    def clear(self, key: str) -> None:
        if key not in self._sent:
            return
        self._sent.discard(key)
        persistent_notification.async_dismiss(self.hass, self._notification_id(key))

    def clear_prefix(self, prefix: str) -> None:
        for key in [k for k in self._sent if k.startswith(prefix)]:
            self.clear(key)
