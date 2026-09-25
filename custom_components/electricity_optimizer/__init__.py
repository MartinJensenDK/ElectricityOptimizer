"""Electricity Optimizer - use cheap and solar power for house and car."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_PRICE_ENTITY,
    DEFAULT_PRICE_ENTITY,
    DOMAIN,
    PANEL_FILENAME,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    STATIC_URL_BASE,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = []


def _integration_version(hass: HomeAssistant) -> str:
    """Read version from manifest for cache busting."""
    from homeassistant.loader import async_get_loaded_integration

    integration = async_get_loaded_integration(hass, DOMAIN)
    return str(integration.version or "0")


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Electricity Optimizer from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        CONF_PRICE_ENTITY: entry.data.get(CONF_PRICE_ENTITY, DEFAULT_PRICE_ENTITY),
    }

    if not hass.data[DOMAIN].get("_static_registered"):
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL_BASE, str(frontend_dir), cache_headers=False)]
        )
        hass.data[DOMAIN]["_static_registered"] = True

    if not hass.data[DOMAIN].get("_panel_registered"):
        version = _integration_version(hass)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_WEBCOMPONENT,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{STATIC_URL_BASE}/{PANEL_FILENAME}?v={version}",
            require_admin=False,
            config={
                "price_entity": entry.data.get(CONF_PRICE_ENTITY, DEFAULT_PRICE_ENTITY),
                "version": version,
            },
        )
        hass.data[DOMAIN]["_panel_registered"] = True

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)

    remaining = [k for k in hass.data[DOMAIN] if not k.startswith("_")]
    if not remaining:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        hass.data[DOMAIN].pop("_panel_registered", None)

    return True
