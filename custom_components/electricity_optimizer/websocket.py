"""Websocket API used by the panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import (
    CONF_SOLAR_ENERGY_MONTH_ENTITY,
    CONF_SOLAR_ENERGY_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TOMORROW_ENTITY,
    CONF_SOLAR_PEAK_KW,
    CONF_SOLAR_POWER_ENTITY,
    DOMAIN,
)
from .storage import validate_car

# solar sensors the panel's settings dialog may change (the same ones as the options flow)
SOLAR_PANEL_ENTITY_KEYS = (
    CONF_SOLAR_POWER_ENTITY,
    CONF_SOLAR_ENERGY_TODAY_ENTITY,
    CONF_SOLAR_ENERGY_MONTH_ENTITY,
    CONF_SOLAR_FORECAST_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TOMORROW_ENTITY,
)


def _runtime(hass: HomeAssistant) -> dict[str, Any]:
    return hass.data[DOMAIN]["ev"]


def _optimizer(hass: HomeAssistant):
    return hass.data[DOMAIN]["optimizer"]


def _serialize(hass: HomeAssistant) -> dict[str, Any]:
    ev = _runtime(hass)
    controller = ev["controller"]
    return {
        "cars": [
            {**car, "runtime": controller.runtime.get(car["id"], {})} for car in ev["store"].cars
        ],
        "context": _optimizer(hass).context_summary(),
    }


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cars/list"})
@websocket_api.async_response
async def ws_cars_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    connection.send_result(msg["id"], _serialize(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/cars/save",
        vol.Required("car"): dict,
    }
)
@websocket_api.async_response
async def ws_cars_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    ev = _runtime(hass)
    raw = dict(msg["car"])
    from .storage import normalize_car  # local import to keep module small

    existing = ev["store"].get(raw["id"]) if raw.get("id") else None
    candidate = normalize_car(raw, existing)
    error = validate_car(candidate)
    if error:
        connection.send_error(msg["id"], "invalid_car", error)
        return
    car = await ev["store"].async_upsert(raw)
    if existing is None or any(k in raw for k in ("charge_now", "start_entity", "stop_entity", "start_value", "stop_value", "current_entity", "enabled")):
        # a manual action or an edited command: the charger may not be in the state we remember, so send again
        ev["controller"].forget_command(car["id"])
    await _optimizer(hass).async_evaluate()
    connection.send_result(msg["id"], {"car": {**car, "runtime": ev["controller"].runtime.get(car["id"], {})}})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/cars/delete", vol.Required("car_id"): str}
)
@websocket_api.async_response
async def ws_cars_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    ev = _runtime(hass)
    ok = await ev["store"].async_delete(msg["car_id"])
    await _optimizer(hass).async_evaluate()
    connection.send_result(msg["id"], {"deleted": ok})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/cars/move", vol.Required("car_id"): str, vol.Required("direction"): vol.In(["up", "down"])}
)
@websocket_api.async_response
async def ws_cars_move(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    ok = await _runtime(hass)["store"].async_move(msg["car_id"], msg["direction"])
    if ok:
        await _optimizer(hass).async_evaluate()
    connection.send_result(msg["id"], _serialize(hass))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/rules/get"})
@websocket_api.async_response
async def ws_rules_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    connection.send_result(msg["id"], {"rules": _optimizer(hass).rules_store.rules, "context": _optimizer(hass).context_summary()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/rules/save", vol.Required("rules"): dict})
@websocket_api.async_response
async def ws_rules_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    opt = _optimizer(hass)
    rules = await opt.rules_store.async_update(msg["rules"])
    await opt.async_evaluate()
    connection.send_result(msg["id"], {"rules": rules, "context": opt.context_summary()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/evaluate"})
@websocket_api.async_response
async def ws_evaluate(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    await _optimizer(hass).async_evaluate()
    connection.send_result(msg["id"], {**_serialize(hass), **_battery_payload(hass)})


@callback
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/history/list"})
@websocket_api.async_response
async def ws_history_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    history = hass.data[DOMAIN].get("history")
    connection.send_result(msg["id"], history.snapshot() if history else {"entries": [], "open": []})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/command/test",
        vol.Required("entity_id"): str,
        vol.Optional("value"): vol.Any(str, None),
        vol.Optional("is_stop", default=False): bool,
        vol.Optional("start_entity"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def ws_command_test(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Run one start/stop command right now so the user can see whether it works."""
    from homeassistant.exceptions import HomeAssistantError

    from .commands import async_run_command

    entity_id = msg["entity_id"].strip()
    if hass.states.get(entity_id) is None:
        connection.send_error(msg["id"], "command_failed", f"{entity_id} findes ikke i Home Assistant")
        return
    try:
        await async_run_command(hass, entity_id, msg.get("value") or None, is_stop=msg["is_stop"], start_entity=msg.get("start_entity") or None, who="Test fra panelet", action="stop" if msg["is_stop"] else "start", reason="Manuel test fra panelet")
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "command_failed", str(err))
        return
    except Exception as err:  # noqa: BLE001 - show whatever the service raised
        connection.send_error(msg["id"], "command_failed", f"{type(err).__name__}: {err}")
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/solar/save", vol.Required("solar"): dict})
@websocket_api.async_response
async def ws_solar_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Save the solar sensors from the panel into the config entry's options.

    An empty value clears the sensor. Changed options reload the entry (as the options flow does),
    which registers the panel again with the new config.
    """
    from . import effective_config  # local import: __init__ imports this module

    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "not_configured", "Electricity Optimizer er ikke sat op")
        return
    entry = entries[0]
    raw = msg["solar"]
    options = dict(entry.options)
    for key in SOLAR_PANEL_ENTITY_KEYS:
        if key not in raw:
            continue
        value = str(raw[key] or "").strip()
        if value and value.split(".")[0] != "sensor":
            connection.send_error(msg["id"], "invalid_solar", f"{value} er ikke en sensor")
            return
        options[key] = value  # "" overrides a value from the initial setup
    if CONF_SOLAR_PEAK_KW in raw:
        peak = raw[CONF_SOLAR_PEAK_KW]
        if peak in (None, ""):
            options[CONF_SOLAR_PEAK_KW] = None
        else:
            try:
                options[CONF_SOLAR_PEAK_KW] = float(str(peak).replace(",", "."))
            except ValueError:
                connection.send_error(msg["id"], "invalid_solar", "Installeret effekt skal være et tal")
                return
            if options[CONF_SOLAR_PEAK_KW] < 0:
                connection.send_error(msg["id"], "invalid_solar", "Installeret effekt må ikke være negativ")
                return
    if options != dict(entry.options):
        hass.config_entries.async_update_entry(entry, options=options)
    connection.send_result(msg["id"], {"config": effective_config(entry)})


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_solar_save)
    websocket_api.async_register_command(hass, ws_command_test)
    websocket_api.async_register_command(hass, ws_history_list)
    websocket_api.async_register_command(hass, ws_cars_list)
    websocket_api.async_register_command(hass, ws_cars_save)
    websocket_api.async_register_command(hass, ws_cars_delete)
    websocket_api.async_register_command(hass, ws_evaluate)
    websocket_api.async_register_command(hass, ws_cars_move)
    websocket_api.async_register_command(hass, ws_rules_get)
    websocket_api.async_register_command(hass, ws_rules_save)
    async_register_battery(hass)


def _battery_payload(hass: HomeAssistant) -> dict[str, Any]:
    bat = hass.data[DOMAIN]["battery"]
    return {"battery": bat["store"].battery, "runtime": bat["controller"].runtime, "context": _optimizer(hass).context_summary()}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/battery/get"})
@websocket_api.async_response
async def ws_battery_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    connection.send_result(msg["id"], _battery_payload(hass))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/battery/save", vol.Required("battery"): dict}
)
@websocket_api.async_response
async def ws_battery_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    from .storage import normalize_battery, validate_battery

    bat = hass.data[DOMAIN]["battery"]
    candidate = normalize_battery(dict(msg["battery"]), bat["store"].battery)
    error = validate_battery(candidate)
    if error:
        connection.send_error(msg["id"], "invalid_battery", error)
        return
    entity_keys = [k for k in candidate if k.endswith("_entity") or k.endswith("_value")]
    old = bat["store"].battery or {}
    if any(candidate.get(k) != old.get(k) for k in entity_keys + ["enabled", "override"]):
        # new commands, Smart styring switched on/off or a manual override: the inverter's state is no longer known
        bat["controller"].reset()
    await bat["store"].async_update(msg["battery"])
    await _optimizer(hass).async_evaluate()
    connection.send_result(msg["id"], _battery_payload(hass))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/battery/delete"})
@websocket_api.async_response
async def ws_battery_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    bat = hass.data[DOMAIN]["battery"]
    await bat["store"].async_delete()
    bat["controller"].reset()
    await _optimizer(hass).async_evaluate()
    connection.send_result(msg["id"], _battery_payload(hass))


@callback
def async_register_battery(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_battery_get)
    websocket_api.async_register_command(hass, ws_battery_save)
    websocket_api.async_register_command(hass, ws_battery_delete)
