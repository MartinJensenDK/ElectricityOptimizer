"""What happened in the price slots that just passed is remembered for the panel's 24-hour strip."""

from datetime import datetime, timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.electricity_optimizer.const import BATTERY_MODES, DOMAIN
from custom_components.electricity_optimizer.ev_controller import Slot, remember_slot

TZ = dt_util.get_time_zone("Europe/Copenhagen")
DAY = datetime(2026, 9, 25, 0, 0, tzinfo=TZ)
SLOTS = [Slot(DAY + timedelta(hours=i), DAY + timedelta(hours=i + 1), 1.0 + i) for i in range(24)]


def test_remember_slot_keeps_the_highest_value_per_slot_and_forgets_old_ones():
    recent: list = []
    remember_slot(recent, DAY + timedelta(hours=10, minutes=5), SLOTS, "chosen", False, int)
    remember_slot(recent, DAY + timedelta(hours=10, minutes=20), SLOTS, "chosen", True, int)
    remember_slot(recent, DAY + timedelta(hours=10, minutes=40), SLOTS, "chosen", False, int)  # charged earlier in the hour
    assert recent == [{"start": SLOTS[10].start.isoformat(), "end": SLOTS[10].end.isoformat(), "price": 11.0, "chosen": True}]
    remember_slot(recent, DAY + timedelta(hours=11, minutes=1), SLOTS, "chosen", False, int)
    assert [(e["start"], e["chosen"]) for e in recent] == [(SLOTS[10].start.isoformat(), True), (SLOTS[11].start.isoformat(), False)]
    # two hours after its end a slot is dropped
    remember_slot(recent, DAY + timedelta(hours=13, minutes=1), SLOTS, "chosen", False, int)
    assert [e["start"] for e in recent] == [SLOTS[11].start.isoformat(), SLOTS[13].start.isoformat()]


def test_remember_slot_ranks_battery_modes_and_survives_missing_prices():
    recent: list = []
    now = DAY + timedelta(hours=3, minutes=10)
    for mode in ("hold", "charge", "normal"):
        remember_slot(recent, now, SLOTS, "mode", mode, BATTERY_MODES.index)
    assert [e["mode"] for e in recent] == ["charge"]
    remember_slot(recent, now, [], "mode", "hold", BATTERY_MODES.index)  # no price slots: nothing to note
    assert [e["mode"] for e in recent] == ["charge"]


async def test_runtime_carries_the_recent_slots(hass: HomeAssistant, hass_ws_client) -> None:
    now = dt_util.now()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    raw_today = [{"hour": day + timedelta(hours=h), "price": 1.5} for h in range(24)]
    hass.states.async_set("sensor.energi_data_service", "1.5", {"raw_today": raw_today, "tomorrow_valid": False})
    hass.states.async_set("sensor.car_soc", "90", {"unit_of_measurement": "%"})
    hass.states.async_set("sensor.bat_soc", "100", {"unit_of_measurement": "%"})
    hass.states.async_set("switch.charger", "off")
    entry = MockConfigEntry(domain=DOMAIN, data={"price_entity": "sensor.energi_data_service"}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    car = {"name": "Tesla", "soc_entity": "sensor.car_soc", "start_entity": "switch.charger", "stop_entity": "switch.charger", "source": "plan"}
    await client.send_json({"id": 1, "type": f"{DOMAIN}/cars/save", "car": car})
    assert (await client.receive_json())["success"]
    await client.send_json({"id": 2, "type": f"{DOMAIN}/battery/save", "battery": {"soc_entity": "sensor.bat_soc"}})
    msg = await client.receive_json()
    assert msg["success"], msg
    hour = now.replace(minute=0, second=0, microsecond=0).isoformat()
    assert [(e["start"], e["mode"]) for e in msg["result"]["runtime"]["recent"]] == [(hour, "normal")]
    await client.send_json({"id": 3, "type": f"{DOMAIN}/cars/list"})
    msg = await client.receive_json()
    assert [(e["start"], e["chosen"]) for e in msg["result"]["cars"][0]["runtime"]["recent"]] == [(hour, False)]
