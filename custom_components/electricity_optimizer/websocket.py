"""Websocket API used by the panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .storage import validate_car


def _runtime(hass: HomeAssistant) -> dict[str, Any]:
    return hass.data[DOMAIN]["ev"]


def _serialize(hass: HomeAssistant) -> dict[str, Any]:
    ev = _runtime(hass)
    controller = ev["controller"]
    return {
        "cars": [
            {**car, "runtime": controller.runtime.get(car["id"], {})} for car in ev["store"].cars
        ],
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
    await ev["controller"].async_evaluate()
    connection.send_result(msg["id"], {"car": {**car, "runtime": ev["controller"].runtime.get(car["id"], {})}})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/cars/delete", vol.Required("car_id"): str}
)
@websocket_api.async_response
async def ws_cars_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    ev = _runtime(hass)
    ok = await ev["store"].async_delete(msg["car_id"])
    await ev["controller"].async_evaluate()
    connection.send_result(msg["id"], {"deleted": ok})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/evaluate"})
@websocket_api.async_response
async def ws_evaluate(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    await _runtime(hass)["controller"].async_evaluate()
    connection.send_result(msg["id"], _serialize(hass))


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_cars_list)
    websocket_api.async_register_command(hass, ws_cars_save)
    websocket_api.async_register_command(hass, ws_cars_delete)
    websocket_api.async_register_command(hass, ws_evaluate)
