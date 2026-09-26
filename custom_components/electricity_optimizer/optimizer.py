"""Coordinates EV and battery controllers with the shared rules."""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from datetime import timedelta

from .battery_controller import BatteryController
from .ev_controller import Context, EvController, read_price_slots
from .storage import RulesStore

_LOGGER = logging.getLogger(__name__)


class Optimizer:
    def __init__(
        self,
        hass: HomeAssistant,
        price_entity: str,
        ev: EvController,
        battery: BatteryController,
        rules: RulesStore,
        config: dict | None = None,
    ) -> None:
        self.hass = hass
        self.price_entity = price_entity
        self.config = config or {}
        self.ev = ev
        self.battery = battery
        self.rules_store = rules
        self.last_context: Context | None = None
        self.history = None  # HistoryTracker, set by __init__

    def _grid_w_from_rules(self) -> float | None:
        rules = self.rules_store.rules
        entity = rules.get("grid_power_entity")
        if not entity:
            return None
        st = self.hass.states.get(entity)
        if st is None or st.state in ("unknown", "unavailable"):
            return None
        try:
            v = float(st.state)
        except ValueError:
            return None
        if (st.attributes.get("unit_of_measurement") or "").lower() == "kw":
            v *= 1000
        return v * (-1 if rules["grid_sign"] == "export_positive" else 1)

    def _kwh(self, entity_id: str | None) -> float | None:
        if not entity_id:
            return None
        st = self.hass.states.get(entity_id)
        if st is None or st.state in ("unknown", "unavailable"):
            return None
        try:
            v = float(st.state)
        except ValueError:
            return None
        unit = (st.attributes.get("unit_of_measurement") or "").lower()
        if unit == "wh":
            v /= 1000
        elif unit == "mwh":
            v *= 1000
        return v

    def solar_w(self) -> float | None:
        entity_id = self.config.get("solar_power_entity")
        if not entity_id:
            return None
        st = self.hass.states.get(entity_id)
        if st is None or st.state in ("unknown", "unavailable"):
            return None
        try:
            v = float(st.state)
        except ValueError:
            return None
        unit = (st.attributes.get("unit_of_measurement") or "W").lower()
        if unit == "kw":
            v *= 1000
        elif unit == "mw":
            v *= 1_000_000
        return v

    def solar_forecast(self) -> dict:
        now = dt_util.now()
        out = {}
        today = self._kwh(self.config.get("solar_forecast_today_entity"))
        tomorrow = self._kwh(self.config.get("solar_forecast_tomorrow_entity"))
        if today is not None:
            out[now.date()] = today
        if tomorrow is not None:
            out[(now + timedelta(days=1)).date()] = tomorrow
        return out

    def build_context(self) -> Context:
        rules = self.rules_store.rules
        live = self.battery.read_live()
        grid_w = live["grid_w"] if live["grid_w"] is not None else self._grid_w_from_rules()
        surplus = None
        if grid_w is not None:
            surplus = -grid_w  # export positive, import negative
        return Context(
            now=dt_util.now(),
            slots=read_price_slots(self.hass, self.price_entity),
            rules=rules,
            battery_cfg=self.battery.store.battery,
            battery_soc=live["soc"],
            battery_w=live["battery_w"],
            grid_w=grid_w,
            surplus_w=surplus,
            battery_charge_w=max(0.0, live["battery_w"]) if live["battery_w"] is not None else 0.0,
            solar_forecast_kwh=self.solar_forecast(),
            solar_w=self.solar_w(),
        )

    async def async_evaluate(self) -> None:
        ctx = self.build_context()
        battery_mode = self.battery.compute(ctx)
        ctx.battery_grid_charging = battery_mode == "charge"
        await self.ev.async_evaluate(ctx)
        await self.battery.async_apply(ctx, battery_mode)
        self.last_context = ctx
        if self.history is not None:
            try:
                await self.history.async_update(ctx, self.ev.store.cars, self.ev.runtime, self.battery.store.battery, self.battery.runtime)
            except Exception:  # noqa: BLE001 - history must never break control
                _LOGGER.exception("History update failed")

    def watched_entities(self) -> set[str]:
        ids = {self.price_entity}
        for car in self.ev.store.cars:
            ids.update(v for k, v in car.items() if k in ("soc_entity", "plugged_entity", "power_entity") and v)
        bat = self.battery.store.battery
        if bat:
            ids.update(v for k, v in bat.items() if k in ("soc_entity", "power_entity", "charge_power_entity", "discharge_power_entity", "grid_power_entity") and v)
        ids.update(v for k, v in self.config.items() if k in ("solar_forecast_today_entity", "solar_forecast_tomorrow_entity", "solar_power_entity") and v)
        if self.rules_store.rules.get("grid_power_entity"):
            ids.add(self.rules_store.rules["grid_power_entity"])
        return ids

    def context_summary(self) -> dict:
        ctx = self.last_context
        if ctx is None:
            return {}
        return {
            "grid_w": ctx.grid_w,
            "battery_w": ctx.battery_w,
            "surplus_w": ctx.surplus_w,
            "solar_w": ctx.solar_w,
            "ev_grid_charging": ctx.ev_grid_charging,
            "ev_amps_total": ctx.ev_amps_total,
            "evaluated_at": ctx.now.isoformat(),
        }
