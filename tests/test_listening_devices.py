"""Listening per device (#541): the shares, and the two buckets that are not a device."""

from aivinnet.lib.listening_devices import DEVICE, NONE, OTHER, build_devices

PHONE = "2f6c1f0e-7a1b-4c1d-9e2a-000000000001"
DESKTOP = "2f6c1f0e-7a1b-4c1d-9e2a-000000000002"
REGISTRY = {PHONE: "Chrome on Android", DESKTOP: "Firefox on Linux"}


def test_the_shares_of_the_listening_time():
    body = build_devices([(PHONE, 600), (DESKTOP, 400)], REGISTRY)

    assert body["total"] == 1000
    assert body["devices"] == [
        {"device_id": PHONE, "name": "Chrome on Android", "kind": DEVICE, "seconds": 600, "share": 0.6},
        {"device_id": DESKTOP, "name": "Firefox on Linux", "kind": DEVICE, "seconds": 400, "share": 0.4},
    ]


def test_the_largest_device_comes_first_whatever_the_row_order():
    body = build_devices([(DESKTOP, 400), (PHONE, 600)], REGISTRY)

    assert [row["name"] for row in body["devices"]] == ["Chrome on Android", "Firefox on Linux"]


def test_an_id_the_registry_does_not_know_is_other_device():
    # A device since deleted from the registry (trimmed past MAX_DEVICES_PER_USER)
    # keeps its plays; they are shown as one "other device" row, not by its id.
    body = build_devices([(PHONE, 300), ("deleted-one", 200), ("deleted-two", 100)], REGISTRY)

    other = [row for row in body["devices"] if row["kind"] == OTHER]
    assert other == [{"device_id": None, "name": "", "kind": OTHER, "seconds": 300, "share": 0.5}]
    assert body["total"] == 600


def test_plays_without_an_id_are_no_device_recorded():
    body = build_devices([(None, 500), (PHONE, 500)], REGISTRY)

    none = [row for row in body["devices"] if row["kind"] == NONE]
    assert none == [{"device_id": None, "name": "", "kind": NONE, "seconds": 500, "share": 0.5}]


def test_repeated_ids_are_added_up():
    body = build_devices([(PHONE, 100), (PHONE, 150), (None, 50)], REGISTRY)

    assert body["devices"][0] == {
        "device_id": PHONE,
        "name": "Chrome on Android",
        "kind": DEVICE,
        "seconds": 250,
        "share": 0.8333,
    }
    assert body["total"] == 300


def test_a_period_without_music_lists_nothing():
    assert build_devices([], REGISTRY) == {"total": 0, "devices": []}


def test_rows_without_seconds_do_not_make_a_device_appear():
    body = build_devices([(PHONE, None), (DESKTOP, 0), (None, 0)], REGISTRY)

    assert body == {"total": 0, "devices": []}


def test_a_tie_puts_the_registered_device_before_the_buckets():
    body = build_devices([(None, 100), ("deleted", 100), (DESKTOP, 100)], REGISTRY)

    assert [row["kind"] for row in body["devices"]] == [DEVICE, OTHER, NONE]
