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
GRID_VOLTAGE = 230
STORAGE_KEY_CARS = f"{DOMAIN}.cars"
STORAGE_VERSION = 1
EVALUATE_INTERVAL_SECONDS = 60
ACTIVATE_DOMAINS = ("switch", "input_boolean", "button", "script", "automation")
CAR_DEFAULTS = {
    "name": "",
    "soc_entity": "",
    "start_entity": "",
    "start_value": "",
    "stop_entity": "",
    "stop_value": "",
    "plugged_entity": "",
    "capacity_kwh": 60.0,
    "charge_amps": 16,
    "phases": 3,
    "current_entity": "",  # optional number entity for the charger's current limit
    "charge_power_kw": 11.04,  # derived: amps * 230 V * phases
    "enabled": True,
    "target_soc": 80,
    "ready_by": "07:00",
    "price_limit": None,
    "charge_now": False,
}

# House battery
STORAGE_KEY_BATTERY = f"{DOMAIN}.battery"
COMMAND_DOMAINS = ACTIVATE_DOMAINS + ("select", "input_select", "number", "input_number")
BATTERY_MODES = ("normal", "hold", "charge")
BATTERY_DEFAULTS = {
    "enabled": True,
    "soc_entity": "",
    "power_entity": "",  # signed battery power, W
    "power_sign": "charge_positive",  # or discharge_positive
    "charge_power_entity": "",  # alternative: two unsigned sensors
    "discharge_power_entity": "",
    "grid_power_entity": "",  # signed grid power, W
    "grid_sign": "import_positive",  # or export_positive
    "house_power_entity": "",
    "capacity_kwh": 10.0,
    "max_charge_kw": 5.0,
    "max_discharge_kw": 5.0,
    "min_soc": 10,
    "max_soc": 100,
    "grid_charge_enabled": False,
    "spread_threshold": 0.5,  # price difference needed (currency/kWh)
    "efficiency": 0.9,  # round trip
    "charge_start_entity": "",
    "charge_start_value": "",
    "charge_stop_entity": "",
    "charge_stop_value": "",
    "hold_start_entity": "",
    "hold_start_value": "",
    "hold_stop_entity": "",
    "hold_stop_value": "",
    "override": "auto",  # auto | normal | hold | charge
}
