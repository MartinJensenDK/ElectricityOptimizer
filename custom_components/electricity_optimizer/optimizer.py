"""Coordinates EV and battery controllers with the shared rules."""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from datetime import datetime, timedelta

from .battery_controller import BatteryController
from .const import STARTUP_HOLD_SECONDS
from .cost import CostTracker
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
        self.cost = CostTracker()  # replaced by __init__ with the persisted one
        self.state = None  # RuntimeStateStore, set by __init__
        self._cost_saved_at: datetime | None = None
        self._startup_hold_until: datetime | None = None

    def hold_for_startup(self) -> None:
        """Home Assistant is starting: wait for the sensors before deciding anything.

        Right after a restart the price, SoC and power sensors of other integrations have no value
        yet. Deciding without them would stop a charge that is under way and start it again a moment
        later, so nothing is evaluated (and no command is sent) until every sensor has a value, or
        until STARTUP_HOLD_SECONDS have passed - a sensor that stays unavailable must not block for ever.
        """
        self._startup_hold_until = dt_util.now() + timedelta(seconds=STARTUP_HOLD_SECONDS)

    def _missing_at_startup(self) -> list[str]:
        missing = []
        for entity_id in sorted(self.watched_entities()):
            st = self.hass.states.get(entity_id)
            if st is None or st.state in ("unknown", "unavailable"):
                missing.append(entity_id)
        if self.price_entity not in missing and not read_price_slots(self.hass, self.price_entity):
            missing.append(self.price_entity)
        return missing

    def _held_at_startup(self) -> bool:
        if self._startup_hold_until is None:
            return False
        missing = self._missing_at_startup()
        if missing and dt_util.now() < self._startup_hold_until:
            _LOGGER.debug("Startup: waiting for %s before evaluating", ", ".join(missing))
            return True
        if missing:
            _LOGGER.warning("Startup: still no value from %s after %s s - continuing without", ", ".join(missing), STARTUP_HOLD_SECONDS)
        self._startup_hold_until = None
        return False

    def _watts(self, entity_id: str | None) -> float | None:
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
        if unit == "kw":
            v *= 1000
        elif unit == "mw":
            v *= 1_000_000
        return v

    def _grid_w_from_rules(self) -> float | None:
        rules = self.rules_store.rules
        v = self._watts(rules.get("grid_power_entity"))
        if v is None:
            return None
        return v * (-1 if rules["grid_sign"] == "export_positive" else 1)

    def _house_w(self, live: dict) -> float | None:
        if live.get("house_w") is not None:
            return live["house_w"]
        return self._watts(self.rules_store.rules.get("house_power_entity"))

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
        solar_w = self.solar_w()
        house_w = self._house_w(live)
        battery_charge = max(0.0, live["battery_w"]) if live["battery_w"] is not None else 0.0
        surplus = None
        surplus_from = "grid"
        if rules["surplus_source"] == "solar_house" and solar_w is not None and house_w is not None:
            # what is left of the production after the house (and what the battery is taking) - the export equivalent
            surplus = solar_w - house_w - battery_charge
            surplus_from = "solar_house"
        elif grid_w is not None:
            surplus = -grid_w  # export positive, import negative
        return Context(
            now=dt_util.now(),
            slots=read_price_slots(self.hass, self.price_entity),
            rules=rules,
            battery_cfg=self.battery.store.battery,
            battery_soc=live["soc"],
            battery_w=live["battery_w"],
            battery_avg_price=self.cost.average("battery"),
            grid_w=grid_w,
            surplus_w=surplus,
            surplus_from=surplus_from,
            house_w=house_w,
            battery_charge_w=battery_charge,
            solar_forecast_kwh=self.solar_forecast(),
            solar_w=solar_w,
        )

    async def async_evaluate(self) -> None:
        if self._held_at_startup():
            return
        ctx = self.build_context()
        battery_mode = self.battery.compute(ctx)
        ctx.battery_grid_charging = battery_mode == "charge"
        await self.ev.async_evaluate(ctx)
        await self.battery.async_apply(ctx, battery_mode)
        self.last_context = ctx
        try:
            self._update_cost(ctx)
        except Exception:  # noqa: BLE001 - the price bookkeeping must never break control
            _LOGGER.exception("Average price update failed")
        if self.history is not None:
            try:
                await self.history.async_update(ctx, self.ev.store.cars, self.ev.runtime, self.battery.store.battery, self.battery.runtime)
            except Exception:  # noqa: BLE001 - history must never break control
                _LOGGER.exception("History update failed")

    COST_SAVE_INTERVAL_S = 300

    def _update_cost(self, ctx: Context) -> None:
        bat = self.battery.store.battery
        self.cost.update(
            ctx,
            self.ev.store.cars,
            self.ev.runtime,
            bat,
            self.battery.runtime,
            charged_kwh=self._kwh(bat.get("charge_energy_entity")) if bat else None,
            discharged_kwh=self._kwh(bat.get("discharge_energy_entity")) if bat else None,
        )
        self.publish_cost()
        if self.cost.dirty and self.state is not None and (self._cost_saved_at is None or (ctx.now - self._cost_saved_at).total_seconds() >= self.COST_SAVE_INTERVAL_S):
            self.cost.dirty = False
            self._cost_saved_at = ctx.now
            self.state.save()

    def publish_cost(self) -> None:
        """Put the average prices and the efficiency in the runtime the panel reads."""
        if self.battery.store.battery is not None:
            self.battery.runtime["cost"] = self.cost.snapshot("battery")
            self.battery.runtime["efficiency"] = self.cost.efficiency_snapshot()
        for car in self.ev.store.cars:
            rt = self.ev.runtime.get(car["id"])
            if rt is not None:
                rt["cost"] = self.cost.snapshot(f"ev:{car['id']}")
                rt["efficiency"] = self.cost.car_efficiency_snapshot(f"ev:{car['id']}")

    def watched_entities(self) -> set[str]:
        ids = {self.price_entity}
        for car in self.ev.store.cars:
            ids.update(v for k, v in car.items() if k in ("soc_entity", "plugged_entity", "power_entity") and v)
        bat = self.battery.store.battery
        if bat:
            ids.update(v for k, v in bat.items() if k in ("soc_entity", "power_entity", "charge_power_entity", "discharge_power_entity", "grid_power_entity") and v)
        ids.update(v for k, v in self.config.items() if k in ("solar_forecast_today_entity", "solar_forecast_tomorrow_entity", "solar_power_entity") and v)
        for key in ("grid_power_entity", "house_power_entity"):
            if self.rules_store.rules.get(key):
                ids.add(self.rules_store.rules[key])
        return ids

    def context_summary(self) -> dict:
        ctx = self.last_context
        if ctx is None:
            return {}
        return {
            "grid_w": ctx.grid_w,
            "battery_w": ctx.battery_w,
            "surplus_w": ctx.surplus_w,
            "surplus_from": ctx.surplus_from,
            "house_w": ctx.house_w,
            "solar_w": ctx.solar_w,
            "ev_grid_charging": ctx.ev_grid_charging,
            "ev_grid_hold": ctx.ev_grid_hold,
            "ev_amps_total": ctx.ev_amps_total,
            "evaluated_at": ctx.now.isoformat(),
        }
