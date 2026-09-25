"""Electricity Optimizer - use cheap and solar power for house and car."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_loaded_integration

from .const import (
    CONF_PRICE_ENTITY,
    CONF_SOLAR_PEAK_KW,
    DEFAULT_PRICE_ENTITY,
    DOMAIN,
    PANEL_FILENAME,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    SOLAR_ENTITY_KEYS,
    STATIC_URL_BASE,
)

_LOGGER = logging.getLogger(__name__)


def effective_config(entry: ConfigEntry) -> dict[str, Any]:
    """Merge entry data and options into the config the panel needs."""
    merged = {**entry.data, **entry.options}
    config: dict[str, Any] = {
        CONF_PRICE_ENTITY: merged.get(CONF_PRICE_ENTITY, DEFAULT_PRICE_ENTITY),
    }
    for key in SOLAR_ENTITY_KEYS:
        if merged.get(key):
            config[key] = merged[key]
    if merged.get(CONF_SOLAR_PEAK_KW):
        config[CONF_SOLAR_PEAK_KW] = float(merged[CONF_SOLAR_PEAK_KW])
    return config


async def _async_register_panel(hass: HomeAssistant, config: dict[str, Any]) -> None:
    """(Re)register the sidebar panel with the current config."""
    version = str(async_get_loaded_integration(hass, DOMAIN).version or "0")
    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_WEBCOMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL_BASE}/{PANEL_FILENAME}?v={version}",
        require_admin=False,
        config={**config, "version": version},
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Electricity Optimizer from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    if not domain_data.get("_static_registered"):
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL_BASE, str(frontend_dir), cache_headers=False)]
        )
        domain_data["_static_registered"] = True

    config = effective_config(entry)
    domain_data[entry.entry_id] = config
    await _async_register_panel(hass, config)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    return True
