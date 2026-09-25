"""Config flow for Electricity Optimizer."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers import selector

from .const import CONF_PRICE_ENTITY, DEFAULT_PRICE_ENTITY, DOMAIN, NAME


def _schema(default_entity: str) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_PRICE_ENTITY, default=default_entity): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor")
            ),
        }
    )


class ElectricityOptimizerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """First and only step: pick the EnergiDataService price sensor."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        errors: dict[str, str] = {}
        if user_input is not None:
            entity_id = user_input[CONF_PRICE_ENTITY]
            state = self.hass.states.get(entity_id)
            if state is None:
                errors[CONF_PRICE_ENTITY] = "entity_not_found"
            elif "raw_today" not in state.attributes:
                errors[CONF_PRICE_ENTITY] = "not_energidataservice"
            else:
                return self.async_create_entry(title=NAME, data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(DEFAULT_PRICE_ENTITY),
            errors=errors,
        )
