"""`GET /logger/devices` — listening per device on the stats page (#541).

Real request cycle, real `ScrobbleTable` rows and the real `DeviceTable`
registry: the device id is read out of `scrobble.extra` by SQLite's
`json_extract`, and the names come from the registry table. A fast-lane test
sees neither of those.
"""

from datetime import datetime

import pytest

PHONE = "2f6c1f0e-7a1b-4c1d-9e2a-000000000001"
DESKTOP = "2f6c1f0e-7a1b-4c1d-9e2a-000000000002"
TRACK = "0853280a12c4f9e1"
ALBUM = "a1b2c3d4e5f60718"


@pytest.fixture()
def devices_api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api
    from aivinnet.db import create_all_tables
    from aivinnet.db.userdata import UserTable

    create_all_tables()
    for username in ("devstats-one", "devstats-two"):
        if UserTable.get_by_username(username) is None:
            UserTable.insert_one({"username": username, "password": "x", "roles": []})

    api = api_client("aivinnet.api.scrobble")
    api.userid = UserTable.get_by_username("devstats-one").id
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    # A cache from another test could match this one's marker (ids restart).
    monkeypatch.setattr(scrobble_api, "_devices", {})
    return api


def register(api, device_id: str, name: str, type_: str = "desktop"):
    from aivinnet.db.userdata import DeviceTable

    DeviceTable.upsert(device_id, api.userid, name, type_)


def scrobble(api, when: datetime, duration: int, device_id: str | None = None):
    from aivinnet.db.userdata import ScrobbleTable

    item = {
        "trackhash": TRACK,
        "timestamp": int(when.timestamp()),
        "duration": duration,
        "source": f"al:{ALBUM}",
        "userid": api.userid,
    }
    if device_id is not None:
        item["extra"] = {"device_id": device_id}
    ScrobbleTable.add(item)


def devices(api, period: str = "alltime"):
    res = api.get(f"/logger/devices?period={period}")
    assert res.status_code == 200, res.json
    return res.json


def rows_by_kind(body, kind):
    return [row for row in body["devices"] if row["kind"] == kind]


def test_the_time_listened_is_shared_out_by_device(devices_api):
    register(devices_api, PHONE, "Chrome on Android", "mobile")
    register(devices_api, DESKTOP, "Firefox on Linux")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 600, PHONE)
    scrobble(devices_api, datetime(2025, 1, 2, 20, 0), 400, DESKTOP)

    body = devices(devices_api)

    assert body["total"] == 1000
    assert [(row["name"], row["share"]) for row in body["devices"]] == [
        ("Chrome on Android", 0.6),
        ("Firefox on Linux", 0.4),
    ]
    assert body["devices"][0]["device_id"] == PHONE


def test_a_deleted_device_is_other_device(devices_api):
    register(devices_api, PHONE, "Chrome on Android", "mobile")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 300, PHONE)
    # Not in the registry any more (trimmed past MAX_DEVICES_PER_USER): its plays stay.
    scrobble(devices_api, datetime(2025, 1, 2, 20, 0), 100, "gone-device")

    (other,) = rows_by_kind(devices(devices_api), "other")
    assert other == {"device_id": None, "name": "", "kind": "other", "seconds": 100, "share": 0.25}


def test_plays_from_before_devices_are_no_device_recorded(devices_api):
    register(devices_api, PHONE, "Chrome on Android", "mobile")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 200)  # no device_id: before #541
    scrobble(devices_api, datetime(2025, 1, 2, 20, 0), 200, PHONE)

    (none,) = rows_by_kind(devices(devices_api), "none")
    assert none["seconds"] == 200
    assert none["share"] == 0.5


def test_a_renamed_device_shows_its_new_name_without_a_new_play(devices_api):
    register(devices_api, PHONE, "Chrome on Android", "mobile")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 200, PHONE)
    assert devices(devices_api)["devices"][0]["name"] == "Chrome on Android"

    # Re-registering the same device refreshes its name; the sums are cached, the names are not.
    register(devices_api, PHONE, "Chrome on Pixel", "mobile")

    assert devices(devices_api)["devices"][0]["name"] == "Chrome on Pixel"


def test_a_new_play_is_counted_at_once(devices_api):
    register(devices_api, PHONE, "Chrome on Android", "mobile")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 600, PHONE)
    assert devices(devices_api)["total"] == 600

    scrobble(devices_api, datetime(2025, 1, 1, 21, 0), 100, PHONE)

    assert devices(devices_api)["devices"][0]["seconds"] == 700


def test_each_user_sees_only_their_own_plays_and_devices(devices_api):
    from aivinnet.db.userdata import UserTable

    register(devices_api, PHONE, "Chrome on Android", "mobile")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 600, PHONE)

    # The second user never registered the phone: the same id is "other device" to them.
    devices_api.userid = UserTable.get_by_username("devstats-two").id
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 50, PHONE)
    body = devices(devices_api)

    assert body["total"] == 50
    assert [row["kind"] for row in body["devices"]] == ["other"]


def test_the_period_bounds_the_plays(devices_api):
    register(devices_api, PHONE, "Chrome on Android", "mobile")
    scrobble(devices_api, datetime(2025, 1, 1, 20, 0), 600, PHONE)

    week = devices(devices_api, "week")

    assert week["total"] == 0 and week["devices"] == []
    assert devices(devices_api)["total"] == 600


def test_an_unknown_period_is_refused(devices_api):
    assert devices_api.get("/logger/devices?period=decade").status_code == 422
