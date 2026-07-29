"""Real-database tests for the device registry.

These deliberately use the REAL SQLite tables (the API-lane conftest points
the config dir at a temp dir before swingmusic is imported). The devicesync
endpoint tests mock DeviceTable away, which is exactly why a broken upsert
shipped: registering a device the second time answered 500 in production
while every test stayed green.
"""

import pytest


@pytest.fixture()
def device_table():
    from swingmusic.db import create_all_tables
    from swingmusic.db.userdata import DeviceTable

    create_all_tables()
    return DeviceTable


def test_upsert_is_idempotent_and_refreshes_the_row(device_table):
    """Re-registering a known device must update it, not raise."""
    device_table.upsert("dev-upsert", 1, "Chrome on Windows", "desktop")

    # Second call is the regression: it used to materialise an ORM entity from
    # an already-closed session ("identity map is no longer valid").
    device_table.upsert("dev-upsert", 1, "Firefox on Windows", "desktop")
    device_table.upsert("dev-upsert", 1, "Firefox on Windows", "desktop")

    rows = [d for d in device_table.get_all_for_user(1) if d["device_id"] == "dev-upsert"]
    assert len(rows) == 1, "upsert must not duplicate the device"
    assert rows[0]["name"] == "Firefox on Windows"
    assert rows[0]["type"] == "desktop"
    assert rows[0]["last_seen"] > 0


def test_devices_are_scoped_per_user(device_table):
    device_table.upsert("dev-shared-id", 1, "User one phone", "mobile")
    device_table.upsert("dev-shared-id", 2, "User two phone", "mobile")

    user1 = [d for d in device_table.get_all_for_user(1) if d["device_id"] == "dev-shared-id"]
    user2 = [d for d in device_table.get_all_for_user(2) if d["device_id"] == "dev-shared-id"]

    assert len(user1) == 1 and user1[0]["name"] == "User one phone"
    assert len(user2) == 1 and user2[0]["name"] == "User two phone"


def test_touch_updates_last_seen(device_table):
    device_table.upsert("dev-touch", 1, "Phone", "mobile")
    device_table.touch("dev-touch", 1, 1_700_000_000)

    row = next(d for d in device_table.get_all_for_user(1) if d["device_id"] == "dev-touch")
    assert row["last_seen"] == 1_700_000_000
