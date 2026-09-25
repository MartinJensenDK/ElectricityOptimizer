"""Shared fixtures."""

import pytest

pytest_plugins = "pytest_homeassistant_custom_component"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Enable loading of custom_components."""
    yield


@pytest.fixture(autouse=True, scope="session")
def _prewarm_pycares():
    """pycares starts a daemon thread on first use; start it before any test so it
    is not reported as a lingering thread by the HA test plugin."""
    try:
        import pycares

        pycares.Channel()
    except Exception:  # noqa: BLE001
        pass
    yield
