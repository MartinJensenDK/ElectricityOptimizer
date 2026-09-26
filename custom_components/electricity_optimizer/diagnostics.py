"""Diagnostics support: download everything needed to debug a setup."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    data = hass.data.get(DOMAIN, {})
    optimizer = data.get("optimizer")
    integration = await async_get_integration(hass, DOMAIN)
    out: dict[str, Any] = {
        "version": integration.version,
        "config": {**entry.data, **entry.options},
    }
    if optimizer is None:
        out["error"] = "optimizer not running"
        return out
    ev, battery = optimizer.ev, optimizer.battery
    out["rules"] = optimizer.rules_store.rules
    out["cars"] = [{**car, "runtime": ev.runtime.get(car["id"], {})} for car in ev.store.cars]
    out["battery"] = {"config": battery.store.battery, "runtime": battery.runtime}
    out["context"] = optimizer.context_summary()
    history = data.get("history")
    if history is not None:
        snap = history.snapshot()
        out["history"] = {"closed_entries": len(snap["entries"]), "open": snap["open"], "last_entries": snap["entries"][:10]}
    states: dict[str, Any] = {}
    for entity_id in sorted(optimizer.watched_entities()):
        st = hass.states.get(entity_id)
        if st is None:
            states[entity_id] = None
            continue
        attrs = {k: v for k, v in st.attributes.items() if k not in ("raw_today", "raw_tomorrow", "today", "tomorrow", "forecast")}
        states[entity_id] = {"state": st.state, "attributes": attrs, "last_updated": st.last_updated.isoformat()}
    out["entities"] = states
    return out
