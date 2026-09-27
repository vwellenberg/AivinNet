"""
Thin HTTP adapter over the in-RAM group-session core (``lib.groupsession``).

Every endpoint is JWT-gated by the global ``before_request`` gate configured in
``app_builder`` — the ``/devicesync`` prefix is deliberately NOT on the auth
allowlist, so unauthenticated requests are rejected before they reach a handler.
Scoping is by ``get_current_userid()``.

The handlers stay intentionally thin: they validate a Pydantic body, translate it
into a single call on the module-level ``manager`` singleton and shape the return
value into JSON. All shared-state logic (versioning, scheduling, presence) lives
in the pure core so it can be unit tested without Flask.

Hot-path discipline: ``/poll`` performs NO database access and no blocking I/O —
it only mutates/reads in-RAM state. bjoern is single-threaded/evented, so a
blocking poll handler would freeze the whole app. The only DB writes in this
module are the device-registry upsert on ``/register`` and the ``last_seen``
touch on ``/leave``.
"""

import time
from typing import Any

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, ConfigDict, Field, field_validator

from aivinnet.db.userdata import DeviceTable
from aivinnet.lib.groupsession import MEMBER_TARGETED_TYPES, manager
from aivinnet.serializers.track import serialize_track
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid

bp_tag = Tag(name="DeviceSync", description="Multiroom device pairing & playback sync")
api = APIBlueprint("devicesync", __name__, url_prefix="/devicesync", abp_tags=[bp_tag])

# Global transport mutations: scheduled LEAD_MS in the future, version-bumped,
# applied to every member (including the initiator).
TRANSPORT_TYPES = frozenset({"play", "pause", "seek", "track_change", "set_repeat"})

# Device-targeted commands: executed immediately by the target, no version bump.
# One list, owned by the core — `join_invite` is the one that may reach a device
# outside the group.
TARGETED_TYPES = MEMBER_TARGETED_TYPES | {"join_invite"}

# Defensive caps on client-supplied lists (a runaway queue would bloat RAM/JSON).
MAX_QUEUE_TRACKS = 5000
MAX_RESOLVE_TRACKS = 1000


class RegisterBody(BaseModel):
    device_id: str = Field(description="Client-generated stable device UUID")
    name: str = Field(description="Human-friendly device name, e.g. 'Chrome on Windows'")
    type: str = Field(description="Device type, e.g. 'desktop', 'phone', 'tablet'")


class SyncDiag(BaseModel):
    """A joined device's own view of its sync, sent with every poll (RAM only)."""

    # inf/NaN would come back out of /devicesync/diag as non-JSON `Infinity`.
    model_config = ConfigDict(allow_inf_nan=False)

    build: str = Field("", description="Web client build (stale bundles are a sync suspect)")
    error_ms: float | None = Field(None, description="Audio position minus expected position; None while unknown")
    rtt_ms: float | None = Field(None, description="Round trip of the clock sample the offset rests on")
    rate: float = Field(1.0, description="playbackRate the steerer has set")
    trim_ms: float = Field(0.0, description="Manual output-latency trim on this device")
    start_ms: float | None = Field(None, description="Learned start latency")
    seek_ms: float | None = Field(None, description="Learned seek latency")


# One calibration run is a handful of devices with a handful of clicks each.
MAX_CALIBRATION_DEVICES = 16
MAX_CALIBRATION_CLICKS = 16
MAX_CALIBRATION_DETAILS = 32

# A detail is a number or a short string (a user agent, a sample format) — never
# a nested structure: the log is read by eye, and it must stay small.
Detail = float | int | bool | str | None


def _bounded_details(value: dict[str, Detail]) -> dict[str, Detail]:
    if len(value) > MAX_CALIBRATION_DETAILS:
        raise ValueError(f"at most {MAX_CALIBRATION_DETAILS} details")
    for key, item in value.items():
        if len(key) > 64 or (isinstance(item, str) and len(item) > 300):
            raise ValueError("detail too long")
    return value


class CalibrationDeviceLog(BaseModel):
    """One device of a calibration run: what it reported, and what was heard."""

    model_config = ConfigDict(allow_inf_nan=False)

    device_id: str = Field(max_length=64)
    name: str = Field("", max_length=120)
    status: str = Field("", max_length=32, description="heard, unclear, no-answer, muted, late, ...")
    sounded_ms: list[float | None] = Field(
        default_factory=list, max_length=MAX_CALIBRATION_CLICKS, description="When each click sounded, as reported"
    )
    offsets_ms: list[float | None] = Field(
        default_factory=list, max_length=MAX_CALIBRATION_CLICKS, description="Arrival minus reported time, per click"
    )
    strengths: list[float | None] = Field(
        default_factory=list, max_length=MAX_CALIBRATION_CLICKS, description="How clearly each click stood out"
    )
    latency_ms: float | None = Field(None, description="Relative to the reference device")
    suggested_trim_ms: float | None = None
    current_trim_ms: float | None = None
    details: dict[str, Detail] = Field(default_factory=dict, description="The device's own notes on its clicks")

    @field_validator("details")
    @classmethod
    def _details(cls, value: dict[str, Detail]) -> dict[str, Detail]:
        return _bounded_details(value)


class CalibrationLogBody(BaseModel):
    """The listening device's raw measurement of one calibration run (RAM only)."""

    model_config = ConfigDict(allow_inf_nan=False)

    device_id: str = Field(max_length=64, description="The listening device")
    run: str = Field(max_length=64)
    devices: list[CalibrationDeviceLog] = Field(max_length=MAX_CALIBRATION_DEVICES)
    details: dict[str, Detail] = Field(default_factory=dict, description="The listener's audio setup")

    @field_validator("details")
    @classmethod
    def _details(cls, value: dict[str, Detail]) -> dict[str, Detail]:
        return _bounded_details(value)


class PollBody(BaseModel):
    device_id: str = Field(description="This device's id")
    known_version: int = Field(0, description="Highest session version the client has already applied")
    client_sent_ms: int = Field(0, description="Client clock at send time (for Cristian offset estimation)")
    volume: float | None = Field(None, description="This device's local volume 0..1, if it changed")
    mute: bool | None = Field(None, description="This device's local mute state, if it changed")
    diag: SyncDiag | None = Field(None, description="Sync self-report of a joined device (diagnostics only)")


class CommandBody(BaseModel):
    device_id: str = Field(description="Originating device id")
    type: str = Field(description="Command type (transport or targeted)")
    payload: dict[str, Any] = Field(default_factory=dict, description="Command-specific payload")
    target_device: str | None = Field(None, description="Target device id (required for targeted commands)")
    # float for the same reason as the positions: it is computed from clock
    # arithmetic in the browser and may carry a fraction. Rounded server-side.
    execute_at_ms: float | None = Field(
        None,
        description="track_change only: server time to switch at (the leader's hand-over at the end of a track)",
    )


class QueueSetBody(BaseModel):
    device_id: str = Field(description="Sending device id (must be a session member)")
    trackhashes: list[str] = Field(description="Full ordered queue of track hashes")
    from_: dict[str, Any] = Field(alias="from", description="The client's 'from' descriptor for the queue")
    currentindex: int = Field(description="Index of the current track within the queue")
    playing: bool = Field(description="Whether playback should be playing after the swap")
    # float, NOT int: the playhead position comes from `audio.currentTime * 1000`
    # and is fractional. A strict int field rejected every queue-set sent while
    # a track was playing (pydantic `int_from_float` -> 422), so the group queue
    # silently never reached the server. Accept the real shape and round here.
    position_ms: float = Field(0, description="Playhead position of the current track (ms, may be fractional)")
    repeat: str = Field("all", description="Repeat mode ('all' / 'one' / 'off')")
    live: bool = Field(
        False,
        description="position_ms is the sender's playhead at send time (queue edits while listening): "
        "the group keeps playing instead of starting over",
    )


class ResolveBody(BaseModel):
    trackhashes: list[str] = Field(description="Track hashes to resolve to full serialized tracks")


class DeviceIdBody(BaseModel):
    device_id: str = Field(description="This device's id")


@api.post("/register")
def register(body: RegisterBody):
    """
    Register/refresh a device: presence in RAM (for live sessions) and the
    persistent registry row. One of only two DB-writing endpoints.
    """
    userid = get_current_userid()
    manager.register(userid, body.device_id, body.name, body.type)
    DeviceTable.upsert(body.device_id, userid, body.name, body.type)
    return {"device_id": body.device_id, "name": body.name, "type": body.type}


@api.post("/poll")
def poll(body: PollBody):
    """
    Hot path (1 s joined / 5 s solo): refresh presence in RAM and return the
    session snapshot. Strictly RAM-only — no DB, no blocking I/O.
    """
    userid = get_current_userid()
    diag = body.diag.model_dump() if body.diag is not None else None
    manager.touch(userid, body.device_id, body.volume, body.mute, diag=diag)
    return manager.snapshot(userid, body.device_id, body.known_version)


@api.get("/diag")
def diag():
    """
    The caller's devices with their recent sync self-reports (RAM only): how
    far each one's audio was from the group anchor, poll by poll. The server
    alone cannot answer "it sounds off" — it knows the plan, not the speakers.
    Next to them, the last few sync calibrations with every click's numbers.
    """
    userid = get_current_userid()
    return {"devices": manager.diagnostics(userid), "calibrations": manager.calibrations(userid)}


@api.post("/calibration-log")
def calibration_log(body: CalibrationLogBody):
    """
    Keep the raw measurement of one sync calibration (RAM only, the last few
    runs per user), readable through ``GET /devicesync/diag``. Only numbers and
    names — the recording itself never leaves the listening device.
    """
    manager.log_calibration(get_current_userid(), body.model_dump())
    return {"msg": "ok"}


@api.post("/command")
def command(body: CommandBody):
    """
    Route a transport (global) or targeted command into the session core.

    Transport types are scheduled LEAD_MS in the future and bump the version;
    targeted types execute immediately on their target and require ``target_device``.
    ``track_change`` is validated against the current queue bounds and may ask
    for a later ``execute_at_ms``.
    """
    userid = get_current_userid()
    ctype = body.type

    if body.execute_at_ms is not None and ctype != "track_change":
        return {"msg": "execute_at_ms is only valid for track_change."}, 400

    if ctype in TRANSPORT_TYPES:
        payload = dict(body.payload)

        # Positions arrive from `audio.currentTime * 1000` and can be fractional;
        # normalise so the anchor math stays in whole milliseconds.
        if isinstance(payload.get("position_ms"), (int, float)):
            payload["position_ms"] = round(payload["position_ms"])

        if ctype == "track_change":
            state = manager.snapshot(userid, body.device_id, known_version=-1).get("state")
            queue_len = len(state["trackhashes"]) if state else 0
            if queue_len == 0:
                return {"msg": "Cannot change track: the queue is empty."}, 400
            try:
                index = int(payload.get("index", 0))
            except (TypeError, ValueError):
                return {"msg": "Invalid track index."}, 400
            payload["index"] = max(0, min(index, queue_len - 1))

        execute_at = round(body.execute_at_ms) if body.execute_at_ms is not None else None
        cmd = manager.apply_transport(userid, body.device_id, ctype, payload, execute_at_ms=execute_at)
    elif ctype in TARGETED_TYPES:
        if not body.target_device:
            return {"msg": "target_device is required for targeted commands."}, 400
        cmd = manager.apply_targeted(userid, body.device_id, ctype, dict(body.payload), body.target_device)
    else:
        return {"msg": f"Unknown command type: {ctype!r}."}, 400

    if cmd is None:
        return {"msg": "Command rejected: no active session, invalid target or execution time."}, 400

    return {"command": cmd}


@api.post("/queue-set")
def queue_set(body: QueueSetBody):
    """
    Replace the session queue (the first joiner seeds the session with its local
    state) and bump the version. A new start schedules an implicit
    ``track_change``; a ``live`` edit keeps the group playing and schedules none.
    """
    userid = get_current_userid()

    trackhashes = body.trackhashes
    if len(trackhashes) > MAX_QUEUE_TRACKS:
        return {"msg": f"Too many trackhashes (max {MAX_QUEUE_TRACKS})."}, 400

    currentindex = max(0, min(body.currentindex, len(trackhashes) - 1)) if trackhashes else 0

    result = manager.set_queue(
        userid,
        body.device_id,
        trackhashes,
        body.from_,
        currentindex,
        body.playing,
        round(body.position_ms),
        body.repeat,
        live=body.live,
    )
    if result is None:
        return {"msg": "Cannot set queue: device is not a session member."}, 400

    return {"command": result["command"]}


@api.post("/resolve")
def resolve(body: ResolveBody):
    """
    Resolve a list of trackhashes to fully serialized tracks, preserving request
    order. Missing hashes are simply absent from the response.
    """
    trackhashes = body.trackhashes
    if len(trackhashes) > MAX_RESOLVE_TRACKS:
        return {"msg": f"Too many trackhashes (max {MAX_RESOLVE_TRACKS})."}, 400

    # Passing a list makes the store preserve request order (missing hashes drop).
    tracks = TrackStore.get_tracks_by_trackhashes(list(trackhashes))
    return {"tracks": [serialize_track(track) for track in tracks]}


@api.post("/join")
def join(body: DeviceIdBody):
    """Join the user's session and return a fresh full snapshot immediately."""
    userid = get_current_userid()
    manager.join(userid, body.device_id)
    return manager.snapshot(userid, body.device_id, 0)


@api.post("/leave")
def leave(body: DeviceIdBody):
    """Leave the session and persist the device's last_seen in the registry."""
    userid = get_current_userid()
    manager.leave(userid, body.device_id)
    DeviceTable.touch(body.device_id, userid, int(time.time()))
    return {"msg": "ok"}
