"""Demo mode: simulated prices, solar, house battery and one car, so the panel can be explored without any real devices.

The simulator writes plain states (no entities are registered) under the `electricity_optimizer_demo_`
prefix and removes them again when the entry is unloaded. Commands to those entities never reach a
real service: commands.py hands them to `handle_command`, which only changes the simulation.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import math
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import (
    CONF_DEMO,
    CONF_PRICE_ENTITY,
    CONF_SOLAR_ENERGY_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TOMORROW_ENTITY,
    CONF_SOLAR_PEAK_KW,
    CONF_SOLAR_POWER_ENTITY,
    GRID_VOLTAGE,
)

PREFIX = "electricity_optimizer_demo_"
UPDATE_SECONDS = 60
MAX_STEP_HOURS = 0.25  # a long pause (e.g. a restart) moves the simulation at most this far

PRICE = f"sensor.{PREFIX}price"
SOLAR_POWER = f"sensor.{PREFIX}solar_power"
SOLAR_TODAY = f"sensor.{PREFIX}solar_energy_today"
FORECAST_TODAY = f"sensor.{PREFIX}solar_forecast_today"
FORECAST_TOMORROW = f"sensor.{PREFIX}solar_forecast_tomorrow"
HOUSE_POWER = f"sensor.{PREFIX}house_power"
GRID_POWER = f"sensor.{PREFIX}grid_power"
BATTERY_SOC = f"sensor.{PREFIX}battery_soc"
BATTERY_POWER = f"sensor.{PREFIX}battery_power"
INVERTER_MODE = f"select.{PREFIX}inverter_mode"
CAR_SOC = f"sensor.{PREFIX}car_soc"
CAR_POWER = f"sensor.{PREFIX}car_power"
CAR_PLUGGED = f"binary_sensor.{PREFIX}car_plugged"
CHARGER = f"switch.{PREFIX}charger"
CHARGER_CURRENT = f"number.{PREFIX}charger_current"

SOLAR_PEAK_KW = 6.5
BATTERY_KWH = 10.0
BATTERY_MAX_W = 5000.0
BATTERY_RESERVE = 10.0
CAR_KWH = 60.0
CAR_PHASES = 3
MODES = ("Self-use", "Hold", "Charge")

DEMO_ENTRY_DATA: dict[str, Any] = {
    CONF_DEMO: True,
    CONF_PRICE_ENTITY: PRICE,
    CONF_SOLAR_POWER_ENTITY: SOLAR_POWER,
    CONF_SOLAR_ENERGY_TODAY_ENTITY: SOLAR_TODAY,
    CONF_SOLAR_FORECAST_TODAY_ENTITY: FORECAST_TODAY,
    CONF_SOLAR_FORECAST_TOMORROW_ENTITY: FORECAST_TOMORROW,
    CONF_SOLAR_PEAK_KW: SOLAR_PEAK_KW,
}

DEMO_CAR: dict[str, Any] = {
    "name": "Demo-bil",
    "soc_entity": CAR_SOC,
    "plugged_entity": CAR_PLUGGED,
    "power_entity": CAR_POWER,
    "start_entity": CHARGER,
    "stop_entity": CHARGER,
    "current_entity": CHARGER_CURRENT,
    "capacity_kwh": CAR_KWH,
    "min_amps": 6,
    "max_amps": 16,
    "phases": CAR_PHASES,
    "source": "solar_plan",
    "target_soc": 80,
    "ready_by": "07:00",
}

DEMO_BATTERY: dict[str, Any] = {
    "soc_entity": BATTERY_SOC,
    "power_entity": BATTERY_POWER,
    "power_sign": "charge_positive",
    "grid_power_entity": GRID_POWER,
    "grid_sign": "import_positive",
    "house_power_entity": HOUSE_POWER,
    "capacity_kwh": BATTERY_KWH,
    "max_charge_kw": BATTERY_MAX_W / 1000,
    "max_discharge_kw": BATTERY_MAX_W / 1000,
    "min_soc": int(BATTERY_RESERVE),
    "grid_charge_enabled": True,
    "charge_start_entity": INVERTER_MODE,
    "charge_start_value": "Charge",
    "charge_stop_entity": INVERTER_MODE,
    "charge_stop_value": "Self-use",
    "hold_start_entity": INVERTER_MODE,
    "hold_start_value": "Hold",
    "hold_stop_entity": INVERTER_MODE,
    "hold_stop_value": "Self-use",
}


def _bump(hour: float, centre: float, width: float) -> float:
    return math.exp(-(((hour - centre) / width) ** 2))


def price_at(hour: int, tomorrow: bool = False) -> float:
    """A typical Danish day: cheap at night and around noon, dear in the morning and early evening."""
    price = 1.6 + 0.9 * _bump(hour, 8, 1.5) + 1.4 * _bump(hour, 18.5, 2.0) - 0.9 * _bump(hour, 13, 2.5) - 0.7 * _bump(hour, 3, 2.5)
    if tomorrow:
        price = price * 0.9 + 0.05 * math.sin(hour)
    return round(price, 2)


def solar_w(hour: float) -> float:
    """Production in W: a bell between 07 and 19 with a little ripple from passing clouds."""
    if not 7 <= hour <= 19:
        return 0.0
    return round(4800 * math.sin(math.pi * (hour - 7) / 12) * (0.85 + 0.15 * math.sin(hour * 5)), 0)


def house_w(hour: float) -> float:
    """House load in W: a base load with a morning and an evening peak."""
    return round(400 + 900 * _bump(hour, 7.5, 1.2) + 1500 * _bump(hour, 18.5, 1.8), 0)


def solar_kwh_until(hour: float) -> float:
    """Energy produced from midnight until `hour` (10-minute steps)."""
    steps = int(max(0.0, min(24.0, hour)) * 6)
    return round(sum(solar_w(i / 6) for i in range(steps)) / 6 / 1000, 2)


class DemoSimulator:
    """Keeps the demo states alive and reacts to the optimizer's commands."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.battery_soc = 55.0
        self.car_soc = 45.0
        self.charger_on = False
        self.charger_amps = 16.0
        self.mode = "Self-use"
        self._last: datetime | None = None
        self._arrived_on: Any = None  # the day the car last came home with a used battery
        self._unsub: Any = None

    @staticmethod
    def owns(entity_id: str) -> bool:
        return entity_id.split(".", 1)[-1].startswith(PREFIX)

    @callback
    def start(self) -> None:
        self.update()
        self._unsub = async_track_time_interval(self.hass, self._tick, timedelta(seconds=UPDATE_SECONDS))

    @callback
    def stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None
        for entity_id in self.hass.states.async_entity_ids():
            if self.owns(entity_id):
                self.hass.states.async_remove(entity_id)

    @callback
    def _tick(self, _now: datetime) -> None:
        self.update()

    @callback
    def handle_command(self, service: str, data: dict[str, Any]) -> None:
        """A command from the optimizer (or a Test button) aimed at a demo entity."""
        entity_id = data.get("entity_id")
        if entity_id == CHARGER and service in ("switch.turn_on", "switch.turn_off"):
            self.charger_on = service == "switch.turn_on"
        elif entity_id == CHARGER_CURRENT and service == "number.set_value":
            self.charger_amps = max(0.0, min(32.0, float(data["value"])))
        elif entity_id == INVERTER_MODE and service == "select.select_option" and data.get("option") in MODES:
            self.mode = data["option"]
        self.update()

    @callback
    def update(self, now: datetime | None = None) -> None:
        """Move the simulation up to `now` and write all states."""
        now = now or dt_util.now()
        hour = now.hour + now.minute / 60 + now.second / 3600
        step = 0.0 if self._last is None else max(0.0, min(MAX_STEP_HOURS, (now - self._last).total_seconds() / 3600))
        self._last = now

        # the car comes home in the late afternoon with a used battery, so there is something to plan every day
        if now.hour >= 17 and self._arrived_on != now.date():
            if self._arrived_on is not None:
                self.car_soc = 40.0
            self._arrived_on = now.date()

        solar, house = solar_w(hour), house_w(hour)
        car = self.charger_amps * GRID_VOLTAGE * CAR_PHASES if self.charger_on and self.car_soc < 100 else 0.0
        net = solar - house - car  # what is left for the battery (negative: the house needs more)
        if self.mode == "Charge":
            battery = BATTERY_MAX_W
        elif self.mode == "Hold":
            battery = max(0.0, min(net, BATTERY_MAX_W))
        else:
            battery = max(-BATTERY_MAX_W, min(net, BATTERY_MAX_W))
        if (battery > 0 and self.battery_soc >= 100) or (battery < 0 and self.battery_soc <= BATTERY_RESERVE):
            battery = 0.0
        grid = house + car + battery - solar  # positive: bought from the grid

        self.battery_soc = max(0.0, min(100.0, self.battery_soc + battery * step / 1000 / BATTERY_KWH * 100))
        self.car_soc = max(0.0, min(100.0, self.car_soc + car * step / 1000 / CAR_KWH * 100))

        day = dt_util.start_of_local_day(now)
        raw_today = [{"hour": day + timedelta(hours=h), "price": price_at(h)} for h in range(24)]
        raw_tomorrow = [{"hour": day + timedelta(days=1, hours=h), "price": price_at(h, tomorrow=True)} for h in range(24)]
        forecast_today = solar_kwh_until(24)

        def put(entity_id: str, value: Any, name: str, unit_of_measurement: str | None = None, **attrs: Any) -> None:
            attributes = {"friendly_name": f"Demo: {name}", **attrs}
            if unit_of_measurement:
                attributes["unit_of_measurement"] = unit_of_measurement
            self.hass.states.async_set(entity_id, str(value), attributes)

        put(
            PRICE,
            price_at(now.hour),
            "elpris",
            "DKK/kWh",
            raw_today=raw_today,
            raw_tomorrow=raw_tomorrow,
            tomorrow_valid=True,
            currency="DKK",
            unit="kWh",
        )
        put(SOLAR_POWER, int(solar), "solceller, effekt", "W", device_class="power")
        put(SOLAR_TODAY, solar_kwh_until(hour), "solceller, i dag", "kWh", device_class="energy")
        put(FORECAST_TODAY, forecast_today, "solprognose i dag", "kWh")
        put(FORECAST_TOMORROW, round(forecast_today * 0.7, 2), "solprognose i morgen", "kWh")
        put(HOUSE_POWER, int(house), "husforbrug", "W", device_class="power")
        put(GRID_POWER, int(grid), "elnet", "W", device_class="power")
        put(BATTERY_SOC, round(self.battery_soc, 1), "husbatteri, ladestand", "%", device_class="battery")
        put(BATTERY_POWER, int(battery), "husbatteri, effekt", "W", device_class="power")
        put(INVERTER_MODE, self.mode, "inverter-modus", options=list(MODES))
        put(CAR_SOC, round(self.car_soc, 1), "bil, ladestand", "%", device_class="battery")
        put(CAR_POWER, int(car), "bil, ladeeffekt", "W", device_class="power")
        put(CAR_PLUGGED, "on", "bil tilsluttet", device_class="plug")
        put(CHARGER, "on" if self.charger_on else "off", "lader")
        put(CHARGER_CURRENT, int(self.charger_amps), "lader, strømgrænse", "A", min=6, max=32, step=1)


async def async_seed(car_store: Any, battery_store: Any) -> None:
    """Give a fresh demo one car and a house battery (later edits in the panel are kept)."""
    if not car_store.cars:
        await car_store.async_upsert(dict(DEMO_CAR))
    if battery_store.battery is None:
        await battery_store.async_update(dict(DEMO_BATTERY))
