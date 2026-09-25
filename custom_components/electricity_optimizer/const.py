"""Constants for the Electricity Optimizer integration."""

DOMAIN = "electricity_optimizer"
NAME = "Electricity Optimizer"

# Config entry keys
CONF_PRICE_ENTITY = "price_entity"
DEFAULT_PRICE_ENTITY = "sensor.energi_data_service"

# Frontend panel
PANEL_URL_PATH = "electricity-optimizer"
PANEL_TITLE = "Electricity Optimizer"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_WEBCOMPONENT = "electricity-optimizer-panel"
STATIC_URL_BASE = "/electricity_optimizer_static"
PANEL_FILENAME = "electricity-optimizer-panel.js"
