"""
Pure-logic core for the multiroom "Group Session" feature.

The server is the source of truth for a per-user playback session that lives
entirely in RAM (module-level singleton + a single lock). A process restart
simply drops every session, at which point clients fall back to solo playback
and keep playing their locally mirrored queue.

This module deliberately has **no Flask / SQLAlchemy imports** so it can be unit
tested in the fast lane with an injected clock. The thin HTTP adapter
(`api/devicesync.py`) and the persistence of the device registry
(`db.userdata.DeviceTable`) live elsewhere and call into this manager.

Concurrency model: every public method takes the manager-wide lock and mutates
only in-RAM dicts. Nothing here blocks on I/O, which keeps it safe to call from
the single-threaded evented WSGI server (bjoern) on the hot poll path.
"""

import hashlib
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

# --- Timing constants (all milliseconds) ------------------------------------

# How far in the future a transport mutation is scheduled so every device can
# convert it to local time (via its estimated clock offset) and execute it
# simultaneously.
LEAD_MS = 1500

# A member/device is considered offline this long after its last poll.
OFFLINE_MS = 5000

# A command is kept around this long past its execution time before being
# pruned, giving a late/slow poller a chance to still observe (and dedupe) it.
COMMAND_GRACE_MS = 5000

# Targeted commands (execute_at_ms == 0, e.g. join_invite) are retained this long
# from their creation time. A non-joined device polls at only ~5 s, so a 5 s grace
# could drop an invite before it is ever observed once jitter is added. Clients
# dedupe by command id, so the longer retention is safe.
TARGETED_COMMAND_TTL_MS = 15000

# Presence entries older than this are forgotten entirely (device long gone).
PRESENCE_TTL_MS = 30 * 60 * 1000


@dataclass
class Session:
    """In-RAM playback session shared by all joined devices of a single user."""

    version: int = 1
    # device_id -> {"joined_at": int, "last_seen": int}
    members: dict[str, dict[str, int]] = field(default_factory=dict)
    trackhashes: list[str] = field(default_factory=list)
    from_: dict[str, Any] = field(default_factory=dict)
    currentindex: int = 0
    playing: bool = False
    repeat: str = "all"
    anchor: dict[str, int] = field(default_factory=lambda: {"position_ms": 0, "at_server_ms": 0})
    # Pending transport (global) + targeted commands, pruned by time.
    pending: list[dict[str, Any]] = field(default_factory=list)


class GroupSessionManager:
    """
    Manages per-user presence and group sessions in RAM.

    A single lock guards **all** public methods. The clock is injectable so
    tests can advance time deterministically.
    """

    def __init__(self, now_ms: Callable[[], int] | None = None) -> None:
        self._now: Callable[[], int] = now_ms or (lambda: int(time.time() * 1000))
        self._lock = threading.Lock()
        # userid -> device_id -> {name, type, last_seen, volume, mute}
        self._presence: dict[int, dict[str, dict[str, Any]]] = {}
        # userid -> Session
        self._sessions: dict[int, Session] = {}

    # --- internal helpers (assume the lock is held) -------------------------

    def _make_command(
        self,
        ctype: str,
        payload: dict[str, Any],
        execute_at_ms: int,
        target_device: str | None,
        now: int,
    ) -> dict[str, Any]:
        return {
            "id": uuid4().hex,
            "type": ctype,
            "payload": payload,
            "execute_at_ms": execute_at_ms,
            "target_device": target_device,
            "created_ms": now,
        }

    def _expected_position(self, session: Session, t: int) -> int:
        """Position the playhead is expected to be at, at server time ``t``."""
        anchor = session.anchor
        if session.playing:
            return anchor["position_ms"] + (t - anchor["at_server_ms"])
        return anchor["position_ms"]

    def _compute_leader(self, session: Session | None) -> str | None:
        """Member with the earliest joined_at; ties broken by smallest device_id."""
        if session is None or not session.members:
            return None
        return min(session.members.items(), key=lambda kv: (kv[1]["joined_at"], kv[0]))[0]

    def _prune_expired_commands(self, session: Session | None, now: int) -> None:
        if session is None:
            return
        kept: list[dict[str, Any]] = []
        for cmd in session.pending:
            if cmd["execute_at_ms"] == 0:
                # Targeted commands execute immediately; age them from creation and
                # keep them for the longer targeted TTL so a slow (~5 s) poller on a
                # non-joined device still catches e.g. a join_invite.
                expiry = cmd["created_ms"] + TARGETED_COMMAND_TTL_MS
            else:
                # Scheduled/transport commands: dropped a short grace past exec time.
                expiry = cmd["execute_at_ms"] + COMMAND_GRACE_MS
            if now > expiry:
                continue
            kept.append(cmd)
        session.pending = kept

    # --- presence -----------------------------------------------------------

    def register(self, userid: int, device_id: str, name: str, dtype: str) -> None:
        """Create/refresh the presence entry for a device (name/type/last_seen)."""
        with self._lock:
            now = self._now()
            devices = self._presence.setdefault(userid, {})
            entry = devices.get(device_id)
            if entry is None:
                devices[device_id] = {
                    "name": name,
                    "type": dtype,
                    "last_seen": now,
                    "volume": None,
                    "mute": False,
                }
            else:
                entry["name"] = name
                entry["type"] = dtype
                entry["last_seen"] = now

    def touch(
        self,
        userid: int,
        device_id: str,
        volume: float | None = None,
        mute: bool | None = None,
    ) -> None:
        """
        Refresh presence last_seen (+ optional volume/mute) and, if the device is
        a session member, its member last_seen. Called on every poll: RAM-only
        and cheap, never touches the DB.
        """
        with self._lock:
            now = self._now()
            devices = self._presence.get(userid)
            if devices is not None:
                entry = devices.get(device_id)
                if entry is not None:
                    entry["last_seen"] = now
                    if volume is not None:
                        entry["volume"] = volume
                    if mute is not None:
                        entry["mute"] = mute

            session = self._sessions.get(userid)
            if session is not None and device_id in session.members:
                session.members[device_id]["last_seen"] = now

    # --- membership ---------------------------------------------------------

    def join(self, userid: int, device_id: str) -> None:
        """
        Add ``device_id`` to the user's session, creating the session (version 1,
        empty queue, paused) if none exists. Session creation counts as version 1;
        adding a member to an already-existing session bumps the version.
        """
        with self._lock:
            now = self._now()
            session = self._sessions.get(userid)
            if session is None:
                session = Session(
                    version=1,
                    trackhashes=[],
                    from_={},
                    currentindex=0,
                    playing=False,
                    repeat="all",
                    anchor={"position_ms": 0, "at_server_ms": now},
                    pending=[],
                )
                session.members[device_id] = {"joined_at": now, "last_seen": now}
                self._sessions[userid] = session
            elif device_id not in session.members:
                session.members[device_id] = {"joined_at": now, "last_seen": now}
                session.version += 1
            else:
                session.members[device_id]["last_seen"] = now
        return None

    def leave(self, userid: int, device_id: str) -> None:
        """Remove a member (bumping version); delete the session once empty."""
        with self._lock:
            session = self._sessions.get(userid)
            if session is None:
                return None
            if device_id in session.members:
                del session.members[device_id]
                session.version += 1
                if not session.members:
                    del self._sessions[userid]
        return None

    # --- queue + transport --------------------------------------------------

    def set_queue(
        self,
        userid: int,
        device_id: str,
        trackhashes: list[str],
        from_: dict[str, Any],
        currentindex: int,
        playing: bool,
        position_ms: int,
        repeat: str,
    ) -> dict[str, Any] | None:
        """
        Replace the session queue and schedule an implicit ``track_change``.

        The sender must be a member (else ``None``). Bumps the version, resets the
        anchor to the scheduled execution time and returns the scheduled command.
        """
        with self._lock:
            session = self._sessions.get(userid)
            if session is None or device_id not in session.members:
                return None

            now = self._now()
            exec_at = now + LEAD_MS

            session.trackhashes = list(trackhashes)
            session.from_ = dict(from_) if from_ else {}
            session.currentindex = currentindex
            session.playing = playing
            session.repeat = repeat
            session.anchor = {"position_ms": position_ms, "at_server_ms": exec_at}
            session.version += 1

            command = self._make_command(
                ctype="track_change",
                payload={"index": currentindex, "position_ms": position_ms, "playing": playing},
                execute_at_ms=exec_at,
                target_device=None,
                now=now,
            )
            session.pending.append(command)
            return command

    def apply_transport(
        self,
        userid: int,
        device_id: str,
        ctype: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        """
        Apply a global transport mutation, scheduled ``LEAD_MS`` in the future.

        Requires an existing session; the sender need NOT be a member (any device
        of the user may control playback). Bumps the version and returns the
        scheduled command, or ``None`` if there is no session / unknown type.
        """
        with self._lock:
            session = self._sessions.get(userid)
            if session is None:
                return None

            now = self._now()
            exec_at = now + LEAD_MS

            if ctype == "play":
                pos = self._expected_position(session, exec_at)
                session.anchor = {"position_ms": pos, "at_server_ms": exec_at}
                session.playing = True
            elif ctype == "pause":
                pos = self._expected_position(session, exec_at)
                session.anchor = {"position_ms": pos, "at_server_ms": exec_at}
                session.playing = False
            elif ctype == "seek":
                session.anchor = {"position_ms": payload["position_ms"], "at_server_ms": exec_at}
                # playing unchanged
            elif ctype == "track_change":
                session.currentindex = payload["index"]
                session.anchor = {"position_ms": payload.get("position_ms", 0), "at_server_ms": exec_at}
                session.playing = payload.get("playing", True)
            elif ctype == "set_repeat":
                session.repeat = payload["repeat"]
                # anchor/playing unchanged; still scheduled for uniformity
            else:
                return None

            session.version += 1
            command = self._make_command(
                ctype=ctype,
                payload=payload,
                execute_at_ms=exec_at,
                target_device=None,
                now=now,
            )
            session.pending.append(command)
            return command

    def apply_targeted(
        self,
        userid: int,
        device_id: str,
        ctype: str,
        payload: dict[str, Any],
        target_device: str,
    ) -> dict[str, Any] | None:
        """
        Queue a device-targeted command (executes immediately, no version bump).

        ``join_invite`` requires the target to exist in presence; the volume/mute/
        transfer commands require the target to be a session member. Returns the
        command, or ``None`` for an invalid target / no session.
        """
        with self._lock:
            session = self._sessions.get(userid)
            if session is None:
                return None

            now = self._now()

            if ctype == "join_invite":
                if target_device not in self._presence.get(userid, {}):
                    return None
            elif ctype in ("set_volume", "set_mute", "play_here"):
                if target_device not in session.members:
                    return None
            else:
                return None

            command = self._make_command(
                ctype=ctype,
                payload=payload,
                execute_at_ms=0,
                target_device=target_device,
                now=now,
            )
            session.pending.append(command)
            return command

    # --- read paths ---------------------------------------------------------

    def snapshot(self, userid: int, device_id: str, known_version: int) -> dict[str, Any]:
        """
        Build the poll response for ``device_id``.

        ``state`` is only present when a session exists AND its version differs
        from ``known_version`` (delta transfer). Global commands are delivered to
        members; targeted commands go to their target device regardless of
        membership (so ``join_invite`` reaches a non-member).
        """
        with self._lock:
            now = self._now()
            session = self._sessions.get(userid)

            self._prune_expired_commands(session, now)

            version = session.version if session is not None else 0
            joined = session is not None and device_id in session.members
            leader = self._compute_leader(session)

            result: dict[str, Any] = {
                "server_now_ms": now,
                "version": version,
                "joined": joined,
                "scrobble_leader": leader,
            }

            if session is not None and version != known_version:
                queue_id = hashlib.sha1("\n".join(session.trackhashes).encode()).hexdigest()
                result["state"] = {
                    "queue_id": queue_id,
                    "trackhashes": list(session.trackhashes),
                    "from": dict(session.from_),
                    "currentindex": session.currentindex,
                    "repeat": session.repeat,
                    "playing": session.playing,
                    "anchor": {
                        "position_ms": session.anchor["position_ms"],
                        "at_server_ms": session.anchor["at_server_ms"],
                    },
                }

            commands: list[dict[str, Any]] = []
            if session is not None:
                is_member = device_id in session.members
                for cmd in session.pending:
                    if cmd["target_device"] is None:
                        if is_member:
                            commands.append(cmd)
                    elif cmd["target_device"] == device_id:
                        commands.append(cmd)
            result["commands"] = commands

            member_ids = set(session.members.keys()) if session is not None else set()
            devices: list[dict[str, Any]] = []
            for did, entry in self._presence.get(userid, {}).items():
                if now - entry["last_seen"] > PRESENCE_TTL_MS:
                    continue
                devices.append(
                    {
                        "device_id": did,
                        "name": entry["name"],
                        "type": entry["type"],
                        "online": (now - entry["last_seen"]) <= OFFLINE_MS,
                        "joined": did in member_ids,
                        "volume": entry.get("volume"),
                        "mute": entry.get("mute", False),
                        "is_leader": did == leader,
                    }
                )
            result["devices"] = devices

            return result

    def compute_leader(self, userid: int) -> str | None:
        """Public wrapper: the current scrobble/transport leader for a user."""
        with self._lock:
            return self._compute_leader(self._sessions.get(userid))

    def prune_expired_commands(self, userid: int) -> None:
        """Public wrapper to drop expired commands for a single user's session."""
        with self._lock:
            self._prune_expired_commands(self._sessions.get(userid), self._now())

    # --- maintenance --------------------------------------------------------

    def reap(self, offline_ms: int = OFFLINE_MS) -> list[tuple[int, str]]:
        """
        Drop stale members (no poll within ``offline_ms``) and empty sessions,
        plus forget presence entries older than ``PRESENCE_TTL_MS``.

        Returns the list of removed ``(userid, device_id)`` pairs so a caller
        (the reaper cron in a later PR) can lazily persist the change.
        """
        with self._lock:
            now = self._now()
            removed: list[tuple[int, str]] = []

            for userid in list(self._sessions.keys()):
                session = self._sessions[userid]
                stale = [did for did, m in session.members.items() if now - m["last_seen"] > offline_ms]
                for did in stale:
                    del session.members[did]
                    removed.append((userid, did))
                if stale:
                    session.version += 1
                if not session.members:
                    del self._sessions[userid]

            for userid in list(self._presence.keys()):
                devices = self._presence[userid]
                expired = [did for did, e in devices.items() if now - e["last_seen"] > PRESENCE_TTL_MS]
                for did in expired:
                    del devices[did]
                if not devices:
                    del self._presence[userid]

            return removed


# Module-level singleton shared by the API layer and the reaper cron.
manager = GroupSessionManager()
