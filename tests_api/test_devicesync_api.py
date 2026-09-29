"""Request-cycle tests for the multiroom device-sync HTTP adapter.

This lane runs the real flask_openapi3 request cycle against the REAL
``aivinnet.api.devicesync`` blueprint. The core (`lib.groupsession`) has its
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

from aivinnet.lib.groupsession import LEAD_MS

USERID = 42


@pytest.fixture()
def ds(monkeypatch):
    """Build a minimal app around the real devicesync blueprint + a fresh core."""
    from aivinnet.api import devicesync
    from aivinnet.lib.groupsession import GroupSessionManager

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


def test_queue_set_accepts_fractional_position(ds):
    """
    Regression: the client sends `audio.currentTime * 1000`, which is fractional.
    A strict int field rejected it with 422, so the group queue never reached the
    server whenever a device joined while a track was playing — every later
    track_change then failed with "queue is empty".
    """
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})

    res = ds.client.post(
        "/devicesync/queue-set",
        json={
            "device_id": "dev-a",
            "trackhashes": ["h1", "h2"],
            "from": {"type": "album"},
            "currentindex": 0,
            "playing": True,
            "position_ms": 3213.456,
            "repeat": "all",
        },
    )

    assert res.status_code == 200
    # Rounded to whole milliseconds for the anchor math.
    assert res.get_json()["command"]["payload"]["position_ms"] == 3213

    poll = _poll(ds, "dev-a", known_version=0)
    assert poll["state"]["trackhashes"] == ["h1", "h2"]
    assert poll["state"]["anchor"]["position_ms"] == 3213


def test_seek_command_accepts_fractional_position(ds):
    """Transport payload positions are fractional too — normalise, don't reject."""
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})

    res = ds.client.post(
        "/devicesync/command",
        json={"device_id": "dev-a", "type": "seek", "payload": {"position_ms": 9876.54}},
    )

    assert res.status_code == 200
    assert res.get_json()["command"]["payload"]["position_ms"] == 9877


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


def test_live_queue_set_keeps_the_group_playing_and_schedules_nothing(ds):
    """
    Regression: every queue edit while listening ("add to queue") anchored the
    sender's playhead LEAD_MS in the future, so all devices jumped back 1.5 s.
    A live edit that keeps the current track leaves the anchor alone.
    """
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})
    start = {"device_id": "dev-a", "trackhashes": ["h1", "h2"], "from": {}, "currentindex": 0, "playing": True}
    ds.client.post("/devicesync/queue-set", json=start)
    anchor_before = _poll(ds, "dev-a", known_version=0)["state"]["anchor"]

    ds.clock["t"] += 30_000
    res = ds.client.post(
        "/devicesync/queue-set",
        json={**start, "trackhashes": ["h1", "h2", "h3"], "position_ms": 28_512.75, "live": True},
    )

    assert res.status_code == 200
    assert res.get_json() == {"command": None}
    state = _poll(ds, "dev-a", known_version=0)["state"]
    assert state["trackhashes"] == ["h1", "h2", "h3"]
    assert state["anchor"] == anchor_before


def test_track_change_accepts_an_explicit_fractional_execution_time(ds):
    """The leader books the next track for the exact end of the current one."""
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})
    ds.client.post(
        "/devicesync/queue-set",
        json={"device_id": "dev-a", "trackhashes": ["h1", "h2"], "from": {}, "currentindex": 0, "playing": True},
    )
    end = ds.clock["t"] + 4_000.6

    res = ds.client.post(
        "/devicesync/command",
        json={
            "device_id": "dev-a",
            "type": "track_change",
            "payload": {"index": 1, "position_ms": 0, "playing": True},
            "execute_at_ms": end,
        },
    )

    assert res.status_code == 200
    assert res.get_json()["command"]["execute_at_ms"] == round(end)
    assert _poll(ds, "dev-a", known_version=0)["state"]["anchor"] == {"position_ms": 0, "at_server_ms": round(end)}


def test_an_execution_time_is_refused_off_track_change_and_too_far_out(ds):
    _register(ds, "dev-a")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})
    ds.client.post(
        "/devicesync/queue-set",
        json={"device_id": "dev-a", "trackhashes": ["h1", "h2"], "from": {}, "currentindex": 0, "playing": True},
    )
    version = _poll(ds, "dev-a", known_version=0)["version"]

    seek = ds.client.post(
        "/devicesync/command",
        json={"device_id": "dev-a", "type": "seek", "payload": {"position_ms": 1}, "execute_at_ms": ds.clock["t"]},
    )
    far = ds.client.post(
        "/devicesync/command",
        json={
            "device_id": "dev-a",
            "type": "track_change",
            "payload": {"index": 1},
            "execute_at_ms": ds.clock["t"] + 3_600_000,
        },
    )

    assert seek.status_code == 400
    assert far.status_code == 400
    # A refused command leaves the session untouched.
    assert _poll(ds, "dev-a", known_version=0)["version"] == version


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


def test_calibration_commands_reach_their_target_and_the_trim_shows_up(ds):
    for did in ("dev-a", "dev-b", "dev-c"):
        _register(ds, did)
    for did in ("dev-a", "dev-b"):
        ds.client.post("/devicesync/join", json={"device_id": did})

    for ctype, payload in (
        ("sync_click", {"run": "r1", "listener": "dev-a", "clicks_ms": [1_003_000.5]}),
        ("sync_ticks", {"run": "r2", "listener": "dev-a", "stop": True}),
        ("set_audio_offset", {"offset_ms": 150}),
    ):
        res = ds.client.post(
            "/devicesync/command",
            json={"device_id": "dev-a", "type": ctype, "payload": payload, "target_device": "dev-b"},
        )
        assert res.status_code == 200, ctype
        cmd_id = res.get_json()["command"]["id"]
        delivered = _poll(ds, "dev-b", known_version=999)["commands"]
        assert any(c["id"] == cmd_id and c["payload"] == payload for c in delivered)

        # dev-c is online but not in the group: refused, not queued.
        outside = ds.client.post(
            "/devicesync/command",
            json={"device_id": "dev-a", "type": ctype, "payload": payload, "target_device": "dev-c"},
        )
        assert outside.status_code == 400

    report = ds.client.post(
        "/devicesync/command",
        json={
            "device_id": "dev-b",
            "type": "sync_click_report",
            "payload": {"run": "r1", "sounded_ms": [1_003_004.25]},
            "target_device": "dev-a",
        },
    )
    assert report.status_code == 200
    assert any(c["type"] == "sync_click_report" for c in _poll(ds, "dev-a", known_version=999)["commands"])

    # The trim a device reports with its poll is shown to every device.
    ds.client.post(
        "/devicesync/poll",
        json={"device_id": "dev-b", "known_version": 0, "diag": {"build": "1.7.60", "trim_ms": 150}},
    )
    devices = {d["device_id"]: d for d in _poll(ds, "dev-a")["devices"]}
    assert devices["dev-b"]["trim_ms"] == 150
    assert devices["dev-c"]["trim_ms"] is None


# --- 8. resolve ---------------------------------------------------------------


def test_resolve_preserves_order_drops_missing_and_caps(ds, monkeypatch):
    from types import SimpleNamespace

    from aivinnet.api import devicesync

    def group(trackhash):
        track = SimpleNamespace(trackhash=trackhash)
        return SimpleNamespace(get_best=lambda: track)

    # The REAL lookup path (trackhashmap), not a stub of a store method: the old
    # stub mirrored a contract ("request order preserved") the store's
    # deduplicating lookup did not keep.
    monkeypatch.setattr(devicesync.TrackStore, "trackhashmap", {h: group(h) for h in ("h1", "h2", "h3")})
    monkeypatch.setattr(devicesync, "serialize_track", lambda track, *a, **k: {"trackhash": track.trackhash})

    res = ds.client.post("/devicesync/resolve", json={"trackhashes": ["h3", "missing", "h1"]})
    assert res.status_code == 200
    hashes = [t["trackhash"] for t in res.get_json()["tracks"]]
    assert hashes == ["h3", "h1"]

    over_cap = ds.client.post("/devicesync/resolve", json={"trackhashes": ["h1"] * (devicesync.MAX_RESOLVE_TRACKS + 1)})
    assert over_cap.status_code == 400


def test_resolve_keeps_a_repeated_song_at_every_position(ds, monkeypatch):
    """A follower maps the answer positionally onto the group's currentindex.
    Deduplicated, [a, b, a, c] came back as [a, b, c] and it played c at index 2."""
    from types import SimpleNamespace

    from aivinnet.api import devicesync

    tracks = {h: SimpleNamespace(trackhash=h) for h in "abc"}
    monkeypatch.setattr(
        devicesync.TrackStore,
        "trackhashmap",
        {h: SimpleNamespace(get_best=lambda t=t: t) for h, t in tracks.items()},
    )
    monkeypatch.setattr(devicesync, "serialize_track", lambda track, *a, **k: {"trackhash": track.trackhash})

    res = ds.client.post("/devicesync/resolve", json={"trackhashes": ["a", "b", "a", "c"]})

    assert [t["trackhash"] for t in res.get_json()["tracks"]] == ["a", "b", "a", "c"]


def test_every_queue_the_group_accepts_can_be_resolved():
    """queue-set took 5000 tracks while resolve refused more than 1000: the other
    devices never mirrored a large queue and retried on every poll."""
    from aivinnet.api import devicesync

    assert devicesync.MAX_RESOLVE_TRACKS >= devicesync.MAX_QUEUE_TRACKS


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


# --- sync diagnostics ----------------------------------------------------------


def test_poll_accepts_a_sync_report_and_diag_returns_it(ds, monkeypatch):
    _register(ds, "dev-a", name="Chrome on Android", dtype="mobile")
    ds.client.post("/devicesync/join", json={"device_id": "dev-a"})

    res = ds.client.post(
        "/devicesync/poll",
        json={
            "device_id": "dev-a",
            "known_version": 0,
            "diag": {"build": "1.7.55", "error_ms": -2.75, "rtt_ms": 9, "rate": 1.00125, "trim_ms": 0},
        },
    )
    assert res.status_code == 200

    out = ds.client.get("/devicesync/diag")
    assert out.status_code == 200
    [device] = out.get_json()["devices"]
    assert device["device_id"] == "dev-a"
    assert device["build"] == "1.7.55"
    sample = dict(zip(device["fields"], device["samples"][0], strict=True))
    assert sample["error_ms"] == -2.75
    assert sample["rate"] == 1.00125

    # Scoped to the caller: another user sees nothing of it.
    from aivinnet.api import devicesync

    monkeypatch.setattr(devicesync, "get_current_userid", lambda: USERID + 1)
    assert ds.client.get("/devicesync/diag").get_json() == {"devices": [], "calibrations": []}


def test_poll_without_a_report_still_works(ds):
    _register(ds, "dev-a")
    res = ds.client.post("/devicesync/poll", json={"device_id": "dev-a", "known_version": 0})
    assert res.status_code == 200
    assert ds.client.get("/devicesync/diag").get_json()["devices"][0]["samples"] == []


def test_a_sync_report_with_infinity_is_refused(ds):
    """/devicesync/diag must stay valid JSON — `Infinity` is not."""
    _register(ds, "dev-a")
    res = ds.client.post(
        "/devicesync/poll",
        data='{"device_id": "dev-a", "diag": {"rtt_ms": 1e999}}',
        content_type="application/json",
    )
    assert res.status_code == 422
    assert ds.client.get("/devicesync/diag").get_json()["devices"][0]["samples"] == []


def _calibration_log(**over):
    body = {
        "device_id": "dev-a",
        "run": "r1",
        "details": {"sample_rate": 48000, "user_agent": "Chrome/140 on Windows"},
        "devices": [
            {
                "device_id": "dev-a",
                "name": "This device",
                "status": "heard",
                "sounded_ms": [1_000_000.5, None],
                "offsets_ms": [12.5, None],
                "strengths": [40.0, None],
                "latency_ms": 0,
                "suggested_trim_ms": 0,
                "current_trim_ms": 0,
                "details": {"rtt_ms": 8, "readings": 212},
            }
        ],
    }
    body.update(over)
    return body


def test_a_calibration_run_is_kept_and_shows_in_diag(ds, monkeypatch):
    res = ds.client.post("/devicesync/calibration-log", json=_calibration_log())
    assert res.status_code == 200

    [run] = ds.client.get("/devicesync/diag").get_json()["calibrations"]
    assert run["run"] == "r1"
    assert run["server_ms"] == ds.clock["t"]
    assert run["details"]["sample_rate"] == 48000
    assert run["devices"][0]["offsets_ms"] == [12.5, None]
    assert run["devices"][0]["details"] == {"rtt_ms": 8, "readings": 212}

    # Scoped to the caller.
    from aivinnet.api import devicesync

    monkeypatch.setattr(devicesync, "get_current_userid", lambda: USERID + 1)
    assert ds.client.get("/devicesync/diag").get_json()["calibrations"] == []


def test_a_calibration_log_refuses_what_would_bloat_or_break_it(ds):
    too_many_clicks = _calibration_log(devices=[{"device_id": "x", "sounded_ms": [1.0] * 17}])
    nested_detail = _calibration_log(details={"x": {"y": 1}})
    many_details = _calibration_log(details={f"k{i}": i for i in range(33)})
    long_detail = _calibration_log(details={"user_agent": "x" * 301})
    for body in (too_many_clicks, nested_detail, many_details, long_detail):
        assert ds.client.post("/devicesync/calibration-log", json=body).status_code == 422

    # `Infinity` would come back out of /devicesync/diag as invalid JSON.
    infinite = ds.client.post(
        "/devicesync/calibration-log",
        data='{"device_id": "a", "run": "r", "devices": [{"device_id": "x", "offsets_ms": [1e999]}]}',
        content_type="application/json",
    )
    assert infinite.status_code == 422
    assert ds.client.get("/devicesync/diag").get_json()["calibrations"] == []
