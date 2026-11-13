"""Electricity Optimizer - use cheap and solar power for house and car."""

from __future__ import annotations

from datetime import timedelta
import logging
from pathlib import Path
from typing import Any

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.loader import async_get_loaded_integration

from . import websocket
from .const import (
    CONF_DEMO,
    CONF_PRICE_ENTITY,
    DEMO_STORAGE_SUFFIX,
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
    EVALUATE_INTERVAL_SECONDS,
)
from .battery_controller import BatteryController
from .demo import DemoSimulator, async_seed
from .ev_controller import EvController
from .history import HistoryStore, HistoryTracker
from .notify import Notifier
from .runtime_state import RuntimeStateStore
from .optimizer import Optimizer
from .storage import BatteryStore, CarStore, RulesStore

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
    if entry.data.get(CONF_DEMO):
        config[CONF_DEMO] = True
    return config


async def _async_register_panel(hass: HomeAssistant, config: dict[str, Any]) -> None:
    """(Re)register the sidebar panel with the current config.

    The script is served under a version-specific path (not a query string) so
    reverse proxies and CDNs that ignore query strings never serve a stale panel.
    """
    version = str(async_get_loaded_integration(hass, DOMAIN).version or "0")
    domain_data = hass.data.setdefault(DOMAIN, {})
    registered: set[str] = domain_data.setdefault("_static_versions", set())
    if version not in registered:
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(f"{STATIC_URL_BASE}/{version}", str(frontend_dir), cache_headers=True)]
        )
        registered.add(version)
    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_WEBCOMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL_BASE}/{version}/{PANEL_FILENAME}",
        require_admin=False,
        config={**config, "version": version},
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Electricity Optimizer from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    config = effective_config(entry)
    domain_data[entry.entry_id] = config

    # demo mode: simulated sensors, and its own storage so real cars, rules and history are never touched
    demo = bool(config.get(CONF_DEMO))
    suffix = DEMO_STORAGE_SUFFIX if demo else ""
    if demo:
        simulator = DemoSimulator(hass)
        simulator.start()  # the states must exist before the first evaluation
        domain_data["demo"] = simulator
        entry.async_on_unload(simulator.stop)

    await _async_register_panel(hass, config)

    store = CarStore(hass, suffix)
    await store.async_load()
    controller = EvController(hass, store, config[CONF_PRICE_ENTITY])
    domain_data["ev"] = {"store": store, "controller": controller}

    battery_store = BatteryStore(hass, suffix)
    await battery_store.async_load()
    if demo:
        await async_seed(store, battery_store)
    battery_controller = BatteryController(hass, battery_store, config[CONF_PRICE_ENTITY])
    domain_data["battery"] = {"store": battery_store, "controller": battery_controller}

    rules_store = RulesStore(hass, suffix)
    await rules_store.async_load()
    optimizer = Optimizer(hass, config[CONF_PRICE_ENTITY], controller, battery_controller, rules_store, config)
    domain_data["optimizer"] = optimizer

    history_store = HistoryStore(hass, suffix)
    await history_store.async_load()
    history = HistoryTracker(hass, history_store)
    optimizer.history = history
    domain_data["history"] = history

    notifier = Notifier(hass, rules_store)
    controller.notifier = notifier
    battery_controller.notifier = notifier
    domain_data["notifier"] = notifier

    # remembered charger/battery state, so a restart does not interrupt charging
    runtime_state = RuntimeStateStore(hass, suffix)
    await runtime_state.async_load()
    controller.state = runtime_state
    controller.restore()
    battery_controller.state = runtime_state
    battery_controller.restore()
    domain_data["runtime_state"] = runtime_state

    if not domain_data.get("_ws_registered"):
        websocket.async_register(hass)
        domain_data["_ws_registered"] = True

    async def _tick(_now: Any) -> None:
        await optimizer.async_evaluate()

    entry.async_on_unload(
        async_track_time_interval(hass, _tick, timedelta(seconds=EVALUATE_INTERVAL_SECONDS))
    )
    hass.async_create_task(optimizer.async_evaluate())

    # Re-evaluate shortly after a relevant sensor changes (prices, SoC, grid/battery power).
    pending: dict[str, Any] = {"handle": None}

    @callback
    def _on_state_changed(event: Event) -> None:
        if event.data.get("entity_id") not in optimizer.watched_entities() or pending["handle"]:
            return

        async def _run(_now: Any) -> None:
            pending["handle"] = None
            await optimizer.async_evaluate()

        pending["handle"] = async_call_later(hass, 2, _run)

    entry.async_on_unload(hass.bus.async_listen(EVENT_STATE_CHANGED, _on_state_changed))

    @callback
    def _cancel_pending() -> None:
        if pending["handle"]:
            pending["handle"]()
            pending["handle"] = None

    entry.async_on_unload(_cancel_pending)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)
    hass.data[DOMAIN].pop("ev", None)
    hass.data[DOMAIN].pop("battery", None)
    hass.data[DOMAIN].pop("optimizer", None)
    hass.data[DOMAIN].pop("demo", None)  # the simulator itself is stopped by the entry's unload callback
    history = hass.data[DOMAIN].pop("history", None)
    hass.data[DOMAIN].pop("notifier", None)
    runtime_state = hass.data[DOMAIN].pop("runtime_state", None)
    if history is not None:
        await history.store.async_save()
    if runtime_state is not None:
        await runtime_state.async_save()
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    return True
