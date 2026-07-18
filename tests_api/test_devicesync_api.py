"""Request-cycle tests for the multiroom device-sync HTTP adapter.

This lane runs the real flask_openapi3 request cycle against the REAL
``swingmusic.api.devicesync`` blueprint. The core (`lib.groupsession`) has its
own pure unit tests; here we assert the thin adapter wires bodies to the manager
correctly and shapes responses/status codes as the client expects.

Per test we inject a FRESH ``GroupSessionManager`` with a deterministic clock by
patching the ``manager`` attribute on the devicesync module, patch
``get_current_userid`` (as imported into the module) to a fixed id, and stub the
two DB-writing ``DeviceTable`` methods so the fast request cycle never needs a
real database.
"""

import pytest
from flask_openapi3 import OpenAPI

from swingmusic.lib.groupsession import LEAD_MS

USERID = 42


@pytest.fixture()
def ds(monkeypatch):
    """Build a minimal app around the real devicesync blueprint + a fresh core."""
    from swingmusic.api import devicesync
    from swingmusic.lib.groupsession import GroupSessionManager

    clock = {"t": 1_000_000}
    fresh_manager = GroupSessionManager(now_ms=lambda: clock["t"])
    monkeypatch.setattr(devicesync, "manager", fresh_manager)
    monkeypatch.setattr(devicesync, "get_current_userid", lambda: USERID)

    # Record the only two DB writes instead of touching a real database.
    calls = {"upsert": [], "touch": []}
    monkeypatch.setattr(
        devicesync.DeviceTable,
        "upsert",
        classmethod(lambda cls, device_id, userid, name, type: calls["upsert"].append((device_id, userid, name, type))),
    )
    monkeypatch.setattr(
        devicesync.DeviceTable,
        "touch",
        classmethod(lambda cls, device_id, userid, timestamp: calls["touch"].append((device_id, userid, timestamp))),
    )

    app = OpenAPI(__name__)
    app.config["TESTING"] = True
    app.register_api(devicesync.api)

    class Handle:
        pass

    handle = Handle()
    handle.client = app.test_client()
    handle.manager = fresh_manager
    handle.clock = clock
    handle.calls = calls
    handle.userid = USERID
    return handle


def _register(ds, device_id, name="Chrome", dtype="desktop"):
    return ds.client.post("/devicesync/register", json={"device_id": device_id, "name": name, "type": dtype})


def _poll(ds, device_id, known_version=0):
    return ds.client.post("/devicesync/poll", json={"device_id": device_id, "known_version": known_version}).get_json()


# --- 1. register --------------------------------------------------------------


def test_register_returns_200_and_upserts(ds):
    res = _register(ds, "dev-a", name="Chrome on Windows", dtype="desktop")
    assert res.status_code == 200
    assert res.get_json() == {"device_id": "dev-a", "name": "Chrome on Windows", "type": "desktop"}

    # The persistent registry write happened exactly once with the right args.
    assert ds.calls["upsert"] == [("dev-a", USERID, "Chrome on Windows", "desktop")]

    # ...and the device now shows up in RAM presence.
    assert any(d["device_id"] == "dev-a" for d in ds.manager.snapshot(USERID, "dev-a", 0)["devices"])


# --- 2. poll with no session --------------------------------------------------


def test_poll_without_session_shape(ds):
    _register(ds, "dev-a")

    res = ds.client.post("/devicesync/poll", json={"device_id": "dev-a"})
    assert res.status_code == 200
    body = res.get_json()

    assert "server_now_ms" in body
    assert body["version"] == 0
    assert body["joined"] is False
    assert "state" not in body
    assert any(d["device_id"] == "dev-a" for d in body["devices"])
    # Hot path must not have written to the registry.
    assert ds.calls["upsert"] == [("dev-a", USERID, "Chrome", "desktop")]
    assert ds.calls["touch"] == []


# --- 3. join ------------------------------------------------------------------


def test_join_snapshot_and_subsequent_poll_joined(ds):
    _register(ds, "dev-a")

    res = ds.client.post("/devicesync/join", json={"device_id": "dev-a"})
    assert res.status_code == 200
    snap = res.get_json()
    assert snap["joined"] is True
    assert snap["version"] >= 1

    # The follow-up poll agrees.
    assert _poll(ds, "dev-a")["joined"] is True


# --- 4. command play schedules in the future ----------------------------------


def test_command_play_schedules_lead_ms_ahead(ds):
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})
    ds.client.post(
        "/devicesync/queue-set",
        json={
            "device_id": "dev-a",
            "trackhashes": ["h1", "h2"],
            "from": {"type": "album", "id": "x"},
            "currentindex": 0,
            "playing": True,
        },
    )

    res = ds.client.post("/devicesync/command", json={"device_id": "dev-a", "type": "play", "payload": {}})
    assert res.status_code == 200
    cmd = res.get_json()["command"]
    assert cmd["type"] == "play"
    # Deterministic clock: execute_at is exactly LEAD_MS ahead of "now".
    assert cmd["execute_at_ms"] == ds.clock["t"] + LEAD_MS


# --- 5. queue-set membership + delta transfer ---------------------------------


def test_queue_set_non_member_rejected_member_ok_and_delta(ds):
    _register(ds, "dev-a")

    # No session yet -> not a member -> 400.
    non_member = ds.client.post(
        "/devicesync/queue-set",
        json={"device_id": "dev-a", "trackhashes": ["h1"], "from": {}, "currentindex": 0, "playing": True},
    )
    assert non_member.status_code == 400

    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})
    ok = ds.client.post(
        "/devicesync/queue-set",
        json={
            "device_id": "dev-a",
            "trackhashes": ["h1", "h2", "h3"],
            "from": {"type": "album"},
            "currentindex": 1,
            "playing": True,
            "repeat": "all",
        },
    )
    assert ok.status_code == 200

    # Old known_version -> full state delta with the new queue.
    poll = _poll(ds, "dev-a", known_version=0)
    assert poll["state"]["trackhashes"] == ["h1", "h2", "h3"]
    version = poll["version"]
    assert version >= 2

    # Equal known_version -> no state key (delta transfer).
    poll_same = _poll(ds, "dev-a", known_version=version)
    assert "state" not in poll_same


def test_queue_set_caps_trackhashes(ds):
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})

    too_many = ds.client.post(
        "/devicesync/queue-set",
        json={
            "device_id": "dev-a",
            "trackhashes": [f"h{i}" for i in range(5001)],
            "from": {},
            "currentindex": 0,
            "playing": True,
        },
    )
    assert too_many.status_code == 400


# --- 6. track_change bounds ---------------------------------------------------


def test_track_change_empty_queue_rejected_and_out_of_bounds_clamped(ds):
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})

    # Empty queue -> 400.
    empty = ds.client.post(
        "/devicesync/command",
        json={"device_id": "dev-a", "type": "track_change", "payload": {"index": 0}},
    )
    assert empty.status_code == 400

    # Seed a 3-track queue, then request an out-of-bounds index.
    ds.client.post(
        "/devicesync/queue-set",
        json={
            "device_id": "dev-a",
            "trackhashes": ["h1", "h2", "h3"],
            "from": {},
            "currentindex": 0,
            "playing": True,
        },
    )
    clamped = ds.client.post(
        "/devicesync/command",
        json={"device_id": "dev-a", "type": "track_change", "payload": {"index": 99}},
    )
    assert clamped.status_code == 200
    # Chosen behavior: clamp into bounds (last index).
    assert clamped.get_json()["command"]["payload"]["index"] == 2

    negative = ds.client.post(
        "/devicesync/command",
        json={"device_id": "dev-a", "type": "track_change", "payload": {"index": -5}},
    )
    assert negative.status_code == 200
    assert negative.get_json()["command"]["payload"]["index"] == 0


# --- 7. targeted commands -----------------------------------------------------


def test_targeted_set_volume_reaches_only_target(ds):
    for did, name in (("dev-a", "A"), ("dev-b", "B")):
        _register(ds, did, name=name)
        ds.client.post("/devicesync/join", json={"device_id": did})

    # Missing target_device -> 400.
    missing = ds.client.post(
        "/devicesync/command",
        json={"device_id": "dev-a", "type": "set_volume", "payload": {"volume": 0.3}},
    )
    assert missing.status_code == 400

    res = ds.client.post(
        "/devicesync/command",
        json={
            "device_id": "dev-a",
            "type": "set_volume",
            "payload": {"volume": 0.3},
            "target_device": "dev-b",
        },
    )
    assert res.status_code == 200
    cmd_id = res.get_json()["command"]["id"]

    # Delivered to the target...
    b_cmds = _poll(ds, "dev-b", known_version=999)["commands"]
    assert any(c["id"] == cmd_id for c in b_cmds)
    # ...absent from the sender.
    a_cmds = _poll(ds, "dev-a", known_version=999)["commands"]
    assert all(c["id"] != cmd_id for c in a_cmds)


# --- 8. resolve ---------------------------------------------------------------


def test_resolve_preserves_order_drops_missing_and_caps(ds, monkeypatch):
    from swingmusic.api import devicesync

    class FakeTrack:
        def __init__(self, trackhash):
            self.trackhash = trackhash

    available = {"h1", "h2", "h3"}

    def fake_get(trackhashes):
        # Mirror the store's contract: request order preserved, missing dropped.
        return [FakeTrack(h) for h in trackhashes if h in available]

    monkeypatch.setattr(devicesync.TrackStore, "get_tracks_by_trackhashes", staticmethod(fake_get))
    monkeypatch.setattr(devicesync, "serialize_track", lambda track, *a, **k: {"trackhash": track.trackhash})

    res = ds.client.post("/devicesync/resolve", json={"trackhashes": ["h3", "missing", "h1"]})
    assert res.status_code == 200
    hashes = [t["trackhash"] for t in res.get_json()["tracks"]]
    assert hashes == ["h3", "h1"]

    over_cap = ds.client.post("/devicesync/resolve", json={"trackhashes": ["h"] * 1001})
    assert over_cap.status_code == 400


# --- 9. leave -----------------------------------------------------------------


def test_leave_resets_membership_and_last_leave_deletes_session(ds):
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})

    res = ds.client.post("/devicesync/leave", json={"device_id": "dev-a"})
    assert res.status_code == 200
    assert res.get_json() == {"msg": "ok"}
    # Leave persists last_seen in the registry.
    assert len(ds.calls["touch"]) == 1
    assert ds.calls["touch"][0][0] == "dev-a"
    assert ds.calls["touch"][0][1] == USERID

    # Sole member left -> session deleted -> version back to 0, not joined.
    poll = _poll(ds, "dev-a", known_version=0)
    assert poll["joined"] is False
    assert poll["version"] == 0
