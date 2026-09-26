"""Generic start/stop commands: an entity plus an optional value."""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import COMMAND_DOMAINS, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_run_command(
    hass: HomeAssistant,
    entity_id: str,
    value: str | None = None,
    *,
    is_stop: bool = False,
    start_entity: str | None = None,
    who: str = "",
    action: str = "",
) -> None:
    """Run one command.

    switch/input_boolean: turn_on - except a stop command on the same entity as start, which turns off.
    button: press. script: turn_on. automation: trigger.
    select/input_select: select_option(value). number/input_number: set_value(value).
    """
    try:
        service, data = _resolve(entity_id, value, is_stop, start_entity)
        _LOGGER.info("Calling %s with %s", service, data)
        await hass.services.async_call(service.split(".", 1)[0], service.split(".", 1)[1], data, blocking=True)
    except Exception as err:
        _record(hass, who, action, entity_id, value, ok=False, error=str(err) or type(err).__name__)
        if isinstance(err, HomeAssistantError):
            raise
        raise HomeAssistantError(f"{type(err).__name__}: {err}") from err
    _record(hass, who, action, entity_id, value, ok=True, service=service)


def _record(hass: HomeAssistant, who: str, action: str, entity_id: str, value: str | None, *, ok: bool, service: str = "", error: str = "") -> None:
    history = (hass.data.get(DOMAIN) or {}).get("history")
    if history is None:
        return
    history.log_command({"who": who, "action": action, "entity_id": entity_id, "value": value, "service": service, "ok": ok, "error": error})


def _resolve(entity_id: str, value: str | None, is_stop: bool, start_entity: str | None) -> tuple[str, dict]:
    """Map an entity + value to the service call to make."""
    if not entity_id:
        raise HomeAssistantError("No entity configured")
    domain = entity_id.split(".", 1)[0]
    if domain not in COMMAND_DOMAINS:
        raise HomeAssistantError(f"Unsupported domain for {entity_id}")
    data: dict = {"entity_id": entity_id}
    if domain in ("switch", "input_boolean"):
        service = "turn_off" if is_stop and entity_id == start_entity else "turn_on"
    elif domain == "button":
        service = "press"
    elif domain == "script":
        service = "turn_on"
    elif domain == "automation":
        service = "trigger"
    elif domain in ("select", "input_select"):
        if not value:
            raise HomeAssistantError(f"{entity_id} needs an option value")
        service = "select_option"
        data["option"] = value
    else:  # number / input_number
        try:
            data["value"] = float(str(value).replace(",", "."))
        except (TypeError, ValueError) as err:
            raise HomeAssistantError(f"{entity_id} needs a numeric value") from err
        service = "set_value"
    return f"{domain}.{service}", data
