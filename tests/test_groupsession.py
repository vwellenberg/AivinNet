"""
Pure unit tests for the multiroom group-session core.

These only import `aivinnet.lib.groupsession` (stdlib-only, no Flask/DB), so
they run in the fast `uvx` lane with a deterministic injected clock.
"""

from itertools import pairwise

from aivinnet.lib.groupsession import (
    COMMAND_GRACE_MS,
    LEAD_MS,
    MAX_SCHEDULE_AHEAD_MS,
    OFFLINE_MS,
    REAP_MS,
    TARGETED_COMMAND_TTL_MS,
    GroupSessionManager,
)

USER = 1
A = "device-a"
B = "device-b"
C = "device-c"


def make_manager(t0: int = 1_000_000):
    """Return a manager with a mutable fake clock: (manager, clock_dict)."""
    clock = {"t": t0}
    mgr = GroupSessionManager(now_ms=lambda: clock["t"])
    return mgr, clock


def current_version(mgr, userid=USER, device=A):
    # known_version=-1 guarantees `state` is included and exposes the version.
    return mgr.snapshot(userid, device, known_version=-1)["version"]


def test_join_creates_session_and_second_join_bumps():
    mgr, clock = make_manager()

    mgr.join(USER, A)
    snap = mgr.snapshot(USER, A, known_version=0)
    assert snap["version"] == 1
    assert snap["joined"] is True

    clock["t"] += 10
    mgr.join(USER, B)
    snap2 = mgr.snapshot(USER, B, known_version=0)
    assert snap2["version"] == 2
    assert snap2["joined"] is True
    # Both devices are members.
    assert mgr._sessions[USER].members.keys() == {A, B}


def test_leave_bumps_and_last_leave_deletes_session():
    mgr, _ = make_manager()

    mgr.join(USER, A)
    mgr.join(USER, B)
    v_before = current_version(mgr)  # 2

    mgr.leave(USER, A)
    assert current_version(mgr) == v_before + 1  # 3
    assert A not in mgr._sessions[USER].members

    mgr.leave(USER, B)  # last member -> session deleted
    snap = mgr.snapshot(USER, B, known_version=99)
    assert snap["version"] == 0
    assert snap["joined"] is False
    assert "state" not in snap
    assert USER not in mgr._sessions


def test_set_queue_bumps_stores_and_schedules_track_change():
    mgr, clock = make_manager()
    mgr.join(USER, A)
    v_before = current_version(mgr)
    t = clock["t"]

    cmd = mgr.set_queue(
        USER,
        A,
        trackhashes=["h1", "h2", "h3"],
        from_={"type": "album", "id": "abc"},
        currentindex=1,
        playing=True,
        position_ms=0,
        repeat="one",
    )["command"]

    assert current_version(mgr) == v_before + 1
    assert cmd is not None
    assert cmd["type"] == "track_change"
    assert cmd["execute_at_ms"] == t + LEAD_MS
    assert cmd["payload"] == {"index": 1, "position_ms": 0, "playing": True}

    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["trackhashes"] == ["h1", "h2", "h3"]
    assert state["from"] == {"type": "album", "id": "abc"}
    assert state["currentindex"] == 1
    assert state["repeat"] == "one"
    assert state["playing"] is True
    assert state["anchor"] == {"position_ms": 0, "at_server_ms": t + LEAD_MS}

    # Non-member sender is rejected.
    assert mgr.set_queue(USER, B, ["x"], {}, 0, True, 0, "all") is None


def test_apply_transport_pause_freezes_expected_position():
    mgr, clock = make_manager()
    mgr.join(USER, A)

    t0 = clock["t"]
    mgr.apply_transport(USER, A, "play", {})  # exec_at = t0 + LEAD, playing True

    play_state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert play_state["playing"] is True
    assert play_state["anchor"] == {"position_ms": 0, "at_server_ms": t0 + LEAD_MS}

    # Advance mid-playback, then pause.
    clock["t"] += 4000
    t1 = clock["t"]
    mgr.apply_transport(USER, A, "pause", {})

    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["playing"] is False
    # Frozen position == progress between the two scheduled execution times.
    expected_pos = (t1 + LEAD_MS) - (t0 + LEAD_MS)
    assert expected_pos == t1 - t0
    assert state["anchor"] == {"position_ms": expected_pos, "at_server_ms": t1 + LEAD_MS}


def test_apply_transport_seek_then_play_and_monotonic_version():
    mgr, clock = make_manager()
    mgr.join(USER, A)

    versions = [current_version(mgr)]

    t_seek = clock["t"]
    mgr.apply_transport(USER, A, "seek", {"position_ms": 90_000})
    versions.append(current_version(mgr))
    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["anchor"] == {"position_ms": 90_000, "at_server_ms": t_seek + LEAD_MS}
    assert state["playing"] is False  # seek leaves playing untouched

    clock["t"] += 500
    t_play = clock["t"]
    mgr.apply_transport(USER, A, "play", {})
    versions.append(current_version(mgr))
    state2 = mgr.snapshot(USER, A, known_version=-1)["state"]
    # Was paused at 90_000, so the expected position at exec time stays frozen.
    assert state2["playing"] is True
    assert state2["anchor"] == {"position_ms": 90_000, "at_server_ms": t_play + LEAD_MS}

    # Strictly increasing across every op.
    assert all(b > a for a, b in pairwise(versions))


def test_compute_leader_earliest_join_then_device_id_tiebreak():
    mgr, clock = make_manager()

    # Distinct join times -> earliest wins.
    mgr.join(USER, B)  # joins first
    clock["t"] += 100
    mgr.join(USER, A)  # later, but lexicographically smaller id
    assert mgr.compute_leader(USER) == B

    # Same join time -> smallest device_id wins the tie-break.
    mgr2, _ = make_manager()
    mgr2.join(USER, B)
    mgr2.join(USER, A)  # same clock value as B
    assert mgr2._sessions[USER].members[A]["joined_at"] == mgr2._sessions[USER].members[B]["joined_at"]
    assert mgr2.compute_leader(USER) == A


def test_reap_removes_stale_member_recomputes_leader_and_deletes_empty():
    mgr, clock = make_manager()
    mgr.join(USER, A)  # leader (earlier)
    clock["t"] += 100
    mgr.join(USER, B)
    assert mgr.compute_leader(USER) == A

    # Advance past OFFLINE_MS, but keep B alive via touch.
    clock["t"] += REAP_MS + 1
    mgr.touch(USER, B)
    v_before = current_version(mgr, device=B)

    removed = mgr.reap()
    assert (USER, A) in removed
    assert A not in mgr._sessions[USER].members
    assert current_version(mgr, device=B) == v_before + 1
    # Leader recomputed onto the surviving member.
    assert mgr.compute_leader(USER) == B

    # Now let B go stale too -> empty session is deleted.
    clock["t"] += REAP_MS + 1
    removed2 = mgr.reap()
    assert (USER, B) in removed2
    assert USER not in mgr._sessions
    assert mgr.compute_leader(USER) is None


def test_briefly_silent_device_shows_offline_but_keeps_its_membership():
    """
    Regression: reaping used the same 5 s window as the offline indicator, so a
    phone whose screen turned off (browser throttles its poll timer) was kicked
    out of the group within seconds. Presence and membership must decay on
    different clocks.
    """
    mgr, clock = make_manager()
    mgr.register(USER, A, "A", "desktop")
    mgr.join(USER, A)

    clock["t"] += OFFLINE_MS + 1000  # silent past the offline indicator...
    assert mgr.reap() == []  # ...but nowhere near the reap window

    snap = mgr.snapshot(USER, A, known_version=0)
    assert snap["joined"] is True
    assert snap["devices"][0]["online"] is False  # shown as offline
    assert snap["devices"][0]["joined"] is True  # still in the group

    # A poll from the woken device restores it fully.
    mgr.touch(USER, A)
    assert mgr.snapshot(USER, A, known_version=0)["devices"][0]["online"] is True


def test_targeted_command_reaches_only_target_and_no_version_bump():
    mgr, _ = make_manager()
    mgr.register(USER, A, "A", "desktop")
    mgr.register(USER, B, "B", "phone")
    mgr.register(USER, C, "C", "phone")  # presence only, never joins
    mgr.join(USER, A)
    mgr.join(USER, B)

    v_before = current_version(mgr)
    cmd = mgr.apply_targeted(USER, A, "set_volume", {"volume": 0.3}, target_device=B)
    assert cmd is not None
    assert cmd["target_device"] == B
    assert cmd["execute_at_ms"] == 0
    # Targeted commands never bump the version.
    assert current_version(mgr) == v_before

    # Only B sees the targeted command; A (a member) does not.
    b_cmds = mgr.snapshot(USER, B, known_version=-1)["commands"]
    a_cmds = mgr.snapshot(USER, A, known_version=-1)["commands"]
    assert any(c["id"] == cmd["id"] for c in b_cmds)
    assert all(c["id"] != cmd["id"] for c in a_cmds)

    # join_invite reaches a non-member device in presence.
    invite = mgr.apply_targeted(USER, A, "join_invite", {}, target_device=C)
    assert invite is not None
    c_snap = mgr.snapshot(USER, C, known_version=0)
    assert c_snap["joined"] is False
    assert any(cc["id"] == invite["id"] for cc in c_snap["commands"])

    # Invalid targets are rejected.
    assert mgr.apply_targeted(USER, A, "set_volume", {}, target_device="ghost") is None
    assert mgr.apply_targeted(USER, A, "join_invite", {}, target_device="ghost") is None


def test_snapshot_state_delta_and_queue_id_changes():
    mgr, _ = make_manager()
    mgr.join(USER, A)
    mgr.set_queue(USER, A, ["h1", "h2"], {}, 0, True, 0, "all")

    version = mgr.snapshot(USER, A, known_version=-1)["version"]

    # Same version -> no state delta.
    same = mgr.snapshot(USER, A, known_version=version)
    assert "state" not in same

    # Older version -> state included.
    delta = mgr.snapshot(USER, A, known_version=version - 1)
    assert "state" in delta
    qid1 = delta["state"]["queue_id"]

    # Changing the trackhashes changes the queue_id.
    mgr.set_queue(USER, A, ["h1", "h2", "h3"], {}, 0, True, 0, "all")
    qid2 = mgr.snapshot(USER, A, known_version=-1)["state"]["queue_id"]
    assert qid1 != qid2


def test_command_is_pruned_after_grace_period():
    mgr, clock = make_manager()
    mgr.join(USER, A)
    cmd = mgr.set_queue(USER, A, ["h1"], {}, 0, True, 0, "all")["command"]

    # Present while within the grace window.
    cmds = mgr.snapshot(USER, A, known_version=-1)["commands"]
    assert any(c["id"] == cmd["id"] for c in cmds)

    # Advance past execute_at + grace -> pruned.
    clock["t"] = cmd["execute_at_ms"] + COMMAND_GRACE_MS + 1
    cmds_after = mgr.snapshot(USER, A, known_version=-1)["commands"]
    assert all(c["id"] != cmd["id"] for c in cmds_after)


def test_targeted_command_survives_grace_but_expires_after_ttl():
    """
    A join_invite (execute_at_ms == 0) must outlive the short transport grace
    window: a non-joined device polls at only ~5 s, so a 5 s grace could drop the
    invite before it is ever seen. It is retained for TARGETED_COMMAND_TTL_MS
    instead (clients dedupe by id), then pruned.
    """
    mgr, clock = make_manager()
    mgr.register(USER, A, "A", "desktop")
    mgr.register(USER, B, "B", "phone")  # presence only, never joins
    mgr.join(USER, A)

    invite = mgr.apply_targeted(USER, A, "join_invite", {}, target_device=B)
    assert invite is not None
    assert invite["execute_at_ms"] == 0

    # Well past the transport grace window (COMMAND_GRACE_MS) but within the
    # targeted TTL: the invite is still delivered to the non-joined target.
    clock["t"] += TARGETED_COMMAND_TTL_MS - 5_000  # +10 s from creation
    assert clock["t"] - invite["created_ms"] > COMMAND_GRACE_MS
    cmds = mgr.snapshot(USER, B, known_version=0)["commands"]
    assert any(c["id"] == invite["id"] for c in cmds)

    # Push beyond the TTL -> pruned.
    clock["t"] += 6_000  # +16 s total from creation, > TARGETED_COMMAND_TTL_MS
    cmds_after = mgr.snapshot(USER, B, known_version=0)["commands"]
    assert all(c["id"] != invite["id"] for c in cmds_after)


def test_fresh_manager_reports_no_session():
    mgr, _ = make_manager()
    snap = mgr.snapshot(USER, A, known_version=0)
    assert snap["version"] == 0
    assert snap["joined"] is False
    assert "state" not in snap
    assert snap["commands"] == []


# --- queue edits while listening (live queue-set) ----------------------------


def playing_session(t_start: int = 1_000_000):
    """A member A playing h2 of [h1, h2, h3], started at t_start + LEAD_MS."""
    mgr, clock = make_manager(t_start)
    mgr.join(USER, A)
    mgr.set_queue(USER, A, ["h1", "h2", "h3"], {}, 1, True, 0, "all")
    return mgr, clock


def test_a_live_edit_keeps_the_group_playing_where_it_is():
    """
    Regression: "add to queue" replayed the last 1.5 s on every device. The
    sender's playhead was anchored LEAD_MS in the FUTURE, so at execution time
    the group was told to be where it had been 1.5 s earlier. A live edit
    that keeps the current track must not touch the anchor at all.
    """
    mgr, clock = playing_session()
    anchor_before = mgr.snapshot(USER, A, known_version=-1)["state"]["anchor"]
    v_before = current_version(mgr)

    clock["t"] += 60_000
    result = mgr.set_queue(USER, A, ["h1", "h2", "h3", "h9"], {}, 1, True, 58_437, "all", live=True)

    assert result == {"command": None}
    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["trackhashes"] == ["h1", "h2", "h3", "h9"]
    assert state["anchor"] == anchor_before  # untouched: nobody seeks
    assert state["playing"] is True
    assert current_version(mgr) == v_before + 1  # still re-mirrored by everyone
    assert all(c["created_ms"] < clock["t"] for c in mgr._sessions[USER].pending)  # no new command


def test_a_live_edit_that_changes_the_track_anchors_the_playhead_now():
    mgr, clock = playing_session()
    clock["t"] += 60_000
    t = clock["t"]

    # The current track is h3 now (the sender's list diverged): its playhead
    # holds NOW, not LEAD_MS from now.
    mgr.set_queue(USER, A, ["h1", "h3"], {}, 1, True, 12_000, "all", live=True)

    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["anchor"] == {"position_ms": 12_000, "at_server_ms": t}


def test_a_live_seed_holds_the_playhead_now():
    """The first joiner seeds an empty group with the song it is playing."""
    mgr, clock = make_manager()
    mgr.join(USER, A)
    t = clock["t"]

    result = mgr.set_queue(USER, A, ["h1", "h2"], {}, 0, True, 42_000, "all", live=True)

    assert result == {"command": None}
    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["anchor"] == {"position_ms": 42_000, "at_server_ms": t}
    assert state["playing"] is True


# --- early track change (the leader's hand-over at the end of a track) -------


def test_an_early_track_change_runs_at_the_requested_time():
    mgr, clock = playing_session()
    clock["t"] += 200_000
    end = clock["t"] + 4_000

    cmd = mgr.apply_transport(USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=end)

    assert cmd is not None
    assert cmd["execute_at_ms"] == end
    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["currentindex"] == 2
    assert state["anchor"] == {"position_ms": 0, "at_server_ms": end}


def test_an_early_track_change_never_runs_sooner_than_the_lead():
    mgr, clock = playing_session()
    clock["t"] += 200_000
    now = clock["t"]

    cmd = mgr.apply_transport(USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=now + 200)

    assert cmd["execute_at_ms"] == now + LEAD_MS
    assert mgr._sessions[USER].early is None  # an ordinary change, nothing to withdraw


def test_an_early_execution_time_is_refused_too_far_out_or_for_other_types():
    mgr, clock = playing_session()
    now = clock["t"]

    too_far = now + MAX_SCHEDULE_AHEAD_MS + 1
    assert mgr.apply_transport(USER, A, "track_change", {"index": 2}, execute_at_ms=too_far) is None
    assert mgr.apply_transport(USER, A, "seek", {"position_ms": 1}, execute_at_ms=now + 4_000) is None
    # Neither attempt mutated anything.
    assert mgr.snapshot(USER, A, known_version=-1)["state"]["currentindex"] == 1


def test_a_seek_before_the_early_change_withdraws_it():
    """
    The leader books the next track seconds ahead. A seek in those seconds
    applies to the track the listener hears — and the booked jump must not
    fire afterwards.
    """
    mgr, clock = playing_session()
    clock["t"] += 200_000
    early = mgr.apply_transport(
        USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=clock["t"] + 4_000
    )

    clock["t"] += 1_000
    seek_at = clock["t"] + LEAD_MS
    mgr.apply_transport(USER, A, "seek", {"position_ms": 30_000})

    snap = mgr.snapshot(USER, A, known_version=-1)
    assert snap["state"]["currentindex"] == 1  # back on the playing track
    assert snap["state"]["playing"] is True
    assert snap["state"]["anchor"] == {"position_ms": 30_000, "at_server_ms": seek_at}
    assert all(c["id"] != early["id"] for c in snap["commands"])  # withdrawn


def test_a_pause_before_the_early_change_freezes_the_track_still_playing():
    mgr, clock = playing_session()
    started = clock["t"] + LEAD_MS
    clock["t"] += 200_000
    mgr.apply_transport(USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=clock["t"] + 4_000)

    clock["t"] += 1_000
    pause_at = clock["t"] + LEAD_MS
    mgr.apply_transport(USER, A, "pause", {})

    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["currentindex"] == 1
    assert state["playing"] is False
    # Frozen on the OLD track's clock, not on the booked track's (which would
    # come out negative: its anchor lies after the pause).
    assert state["anchor"] == {"position_ms": pause_at - started, "at_server_ms": pause_at}


def test_the_early_change_stands_once_its_time_has_come():
    mgr, clock = playing_session()
    clock["t"] += 200_000
    end = clock["t"] + 4_000
    mgr.apply_transport(USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=end)

    clock["t"] = end + 3_000  # the next track has been playing for 3 s
    pause_at = clock["t"] + LEAD_MS
    mgr.apply_transport(USER, A, "pause", {})

    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["currentindex"] == 2
    assert state["anchor"] == {"position_ms": pause_at - end, "at_server_ms": pause_at}


def test_a_live_edit_during_an_early_change_keeps_the_playing_track_going():
    mgr, clock = playing_session()
    anchor_playing = mgr.snapshot(USER, A, known_version=-1)["state"]["anchor"]
    clock["t"] += 200_000
    mgr.apply_transport(USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=clock["t"] + 4_000)

    clock["t"] += 500
    # The sender still hears h2 (index 1) and appends a track.
    mgr.set_queue(USER, A, ["h1", "h2", "h3", "h9"], {}, 1, True, 200_000, "all", live=True)

    state = mgr.snapshot(USER, A, known_version=-1)["state"]
    assert state["currentindex"] == 1
    assert state["anchor"] == anchor_playing  # continuous, no seek anywhere
    assert mgr._sessions[USER].early is None  # the leader books again for the new queue


def test_a_repeat_toggle_leaves_the_early_change_standing():
    mgr, clock = playing_session()
    clock["t"] += 200_000
    end = clock["t"] + 4_000
    early = mgr.apply_transport(USER, A, "track_change", {"index": 2, "position_ms": 0}, execute_at_ms=end)

    mgr.apply_transport(USER, A, "set_repeat", {"repeat": "one"})

    snap = mgr.snapshot(USER, A, known_version=-1)
    assert snap["state"]["currentindex"] == 2
    assert snap["state"]["anchor"] == {"position_ms": 0, "at_server_ms": end}
    assert any(c["id"] == early["id"] for c in snap["commands"])
