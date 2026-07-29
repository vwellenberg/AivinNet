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
    """The table plus two owning users — `device.userid` is a real FK."""
    from swingmusic.db import create_all_tables
    from swingmusic.db.userdata import DeviceTable, UserTable

    create_all_tables()

    for username in ("devicetest-one", "devicetest-two"):
        if UserTable.get_by_username(username) is None:
            UserTable.insert_one({"username": username, "password": "x", "roles": []})

    return DeviceTable


@pytest.fixture()
def user_ids(device_table):
    from swingmusic.db.userdata import UserTable

    return (
        UserTable.get_by_username("devicetest-one").id,
        UserTable.get_by_username("devicetest-two").id,
    )


def test_upsert_is_idempotent_and_refreshes_the_row(device_table, user_ids):
    """Re-registering a known device must update it, not raise."""
    uid, _ = user_ids
    device_table.upsert("dev-upsert", uid, "Chrome on Windows", "desktop")

    # Second call is the regression: it used to materialise an ORM entity from
    # an already-closed session ("identity map is no longer valid").
    device_table.upsert("dev-upsert", uid, "Firefox on Windows", "desktop")
    device_table.upsert("dev-upsert", uid, "Firefox on Windows", "desktop")

    rows = [d for d in device_table.get_all_for_user(uid) if d["device_id"] == "dev-upsert"]
    assert len(rows) == 1, "upsert must not duplicate the device"
    assert rows[0]["name"] == "Firefox on Windows"
    assert rows[0]["type"] == "desktop"
    assert rows[0]["last_seen"] > 0


def test_devices_are_scoped_per_user(device_table, user_ids):
    uid1, uid2 = user_ids
    device_table.upsert("dev-shared-id", uid1, "User one phone", "mobile")
    device_table.upsert("dev-shared-id", uid2, "User two phone", "mobile")

    user1 = [d for d in device_table.get_all_for_user(uid1) if d["device_id"] == "dev-shared-id"]
    user2 = [d for d in device_table.get_all_for_user(uid2) if d["device_id"] == "dev-shared-id"]

    assert len(user1) == 1 and user1[0]["name"] == "User one phone"
    assert len(user2) == 1 and user2[0]["name"] == "User two phone"


def test_touch_updates_last_seen(device_table, user_ids):
    uid, _ = user_ids
    device_table.upsert("dev-touch", uid, "Phone", "mobile")
    device_table.touch("dev-touch", uid, 1_700_000_000)

    row = next(d for d in device_table.get_all_for_user(uid) if d["device_id"] == "dev-touch")
    assert row["last_seen"] == 1_700_000_000
