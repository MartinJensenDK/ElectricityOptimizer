"""Config and options flow for Electricity Optimizer."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_PRICE_ENTITY,
    CONF_SOLAR_ENERGY_TODAY_ENTITY,
    CONF_SOLAR_ENERGY_TOTAL_ENTITY,
    CONF_SOLAR_FORECAST_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TOMORROW_ENTITY,
    CONF_SOLAR_PEAK_KW,
    CONF_SOLAR_POWER_ENTITY,
    DEFAULT_PRICE_ENTITY,
    DOMAIN,
    NAME,
)


def _sensor(device_class: str | None = None) -> selector.EntitySelector:
    cfg: dict[str, Any] = {"domain": "sensor"}
    if device_class:
        cfg["device_class"] = device_class
    return selector.EntitySelector(selector.EntitySelectorConfig(**cfg))


def _suggest(current: dict[str, Any], key: str) -> dict[str, Any]:
    return {"suggested_value": current[key]} if current.get(key) not in (None, "") else {}


def _user_schema(current: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_PRICE_ENTITY, default=current.get(CONF_PRICE_ENTITY, DEFAULT_PRICE_ENTITY)
            ): _sensor(),
        }
    )


def _solar_schema(current: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(CONF_SOLAR_POWER_ENTITY, description=_suggest(current, CONF_SOLAR_POWER_ENTITY)): _sensor("power"),
            vol.Optional(CONF_SOLAR_ENERGY_TODAY_ENTITY, description=_suggest(current, CONF_SOLAR_ENERGY_TODAY_ENTITY)): _sensor("energy"),
            vol.Optional(CONF_SOLAR_ENERGY_TOTAL_ENTITY, description=_suggest(current, CONF_SOLAR_ENERGY_TOTAL_ENTITY)): _sensor("energy"),
            vol.Optional(CONF_SOLAR_FORECAST_TODAY_ENTITY, description=_suggest(current, CONF_SOLAR_FORECAST_TODAY_ENTITY)): _sensor(),
            vol.Optional(CONF_SOLAR_FORECAST_TOMORROW_ENTITY, description=_suggest(current, CONF_SOLAR_FORECAST_TOMORROW_ENTITY)): _sensor(),
            vol.Optional(CONF_SOLAR_PEAK_KW, description=_suggest(current, CONF_SOLAR_PEAK_KW)): selector.NumberSelector(
                selector.NumberSelectorConfig(min=0, max=1000, step=0.1, unit_of_measurement="kWp", mode="box")
            ),
        }
    )


class ElectricityOptimizerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup."""

    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return ElectricityOptimizerOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1: pick the EnergiDataService price sensor."""
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
                self._data.update(user_input)
                return await self.async_step_solar()

        return self.async_show_form(
            step_id="user",
            data_schema=_user_schema(self._data),
            errors=errors,
        )

    async def async_step_solar(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 2 (optional): solar entities."""
        if user_input is not None:
            self._data.update(user_input)
            return self.async_create_entry(title=NAME, data=self._data)

        return self.async_show_form(step_id="solar", data_schema=_solar_schema(self._data))


class ElectricityOptimizerOptionsFlow(OptionsFlow):
    """Change price sensor and solar entities after setup."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        entry = self.hass.config_entries.async_get_entry(self.handler)
        current = {**entry.data, **entry.options} if entry else {}

        errors: dict[str, str] = {}
        if user_input is not None:
            state = self.hass.states.get(user_input[CONF_PRICE_ENTITY])
            if state is None:
                errors[CONF_PRICE_ENTITY] = "entity_not_found"
            elif "raw_today" not in state.attributes:
                errors[CONF_PRICE_ENTITY] = "not_energidataservice"
            else:
                return self.async_create_entry(title="", data=user_input)

        schema = _user_schema(current).extend(_solar_schema(current).schema)
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
