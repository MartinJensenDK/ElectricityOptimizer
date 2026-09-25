"""Constants for the Electricity Optimizer integration."""

DOMAIN = "electricity_optimizer"
NAME = "Electricity Optimizer"

# Config entry keys
CONF_PRICE_ENTITY = "price_entity"
DEFAULT_PRICE_ENTITY = "sensor.energi_data_service"

# Solar (all optional)
CONF_SOLAR_POWER_ENTITY = "solar_power_entity"  # W or kW, current production
CONF_SOLAR_ENERGY_TODAY_ENTITY = "solar_energy_today_entity"  # kWh produced today
CONF_SOLAR_ENERGY_TOTAL_ENTITY = "solar_energy_total_entity"  # kWh lifetime
CONF_SOLAR_FORECAST_TODAY_ENTITY = "solar_forecast_today_entity"  # kWh forecast today
CONF_SOLAR_FORECAST_TOMORROW_ENTITY = "solar_forecast_tomorrow_entity"  # kWh forecast tomorrow
CONF_SOLAR_PEAK_KW = "solar_peak_kw"  # installed peak power, kWp

SOLAR_ENTITY_KEYS = (
    CONF_SOLAR_POWER_ENTITY,
    CONF_SOLAR_ENERGY_TODAY_ENTITY,
    CONF_SOLAR_ENERGY_TOTAL_ENTITY,
    CONF_SOLAR_FORECAST_TODAY_ENTITY,
    CONF_SOLAR_FORECAST_TOMORROW_ENTITY,
)

# Frontend panel
PANEL_URL_PATH = "electricity-optimizer"
PANEL_TITLE = "Electricity Optimizer"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_WEBCOMPONENT = "electricity-optimizer-panel"
STATIC_URL_BASE = "/electricity_optimizer_static"
PANEL_FILENAME = "electricity-optimizer-panel.js"

# EV charging
STORAGE_KEY_CARS = f"{DOMAIN}.cars"
STORAGE_VERSION = 1
EVALUATE_INTERVAL_SECONDS = 60
ACTIVATE_DOMAINS = ("switch", "input_boolean", "button", "script", "automation")
CAR_DEFAULTS = {
    "name": "",
    "soc_entity": "",
    "start_entity": "",
    "stop_entity": "",
    "plugged_entity": "",
    "capacity_kwh": 60.0,
    "charge_power_kw": 11.0,
    "enabled": True,
    "target_soc": 80,
    "ready_by": "07:00",
    "price_limit": None,
    "charge_now": False,
}
