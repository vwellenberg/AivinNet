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
from pydantic import BaseModel, Field

from swingmusic.db.userdata import DeviceTable
from swingmusic.lib.groupsession import manager
from swingmusic.serializers.track import serialize_track
from swingmusic.store.tracks import TrackStore
from swingmusic.utils.auth import get_current_userid

bp_tag = Tag(name="DeviceSync", description="Multiroom device pairing & playback sync")
api = APIBlueprint("devicesync", __name__, url_prefix="/devicesync", abp_tags=[bp_tag])

# Global transport mutations: scheduled LEAD_MS in the future, version-bumped,
# applied to every member (including the initiator).
TRANSPORT_TYPES = frozenset({"play", "pause", "seek", "track_change", "set_repeat"})

# Device-targeted commands: executed immediately by the target, no version bump.
TARGETED_TYPES = frozenset({"set_volume", "set_mute", "join_invite", "play_here"})

# Defensive caps on client-supplied lists (a runaway queue would bloat RAM/JSON).
MAX_QUEUE_TRACKS = 5000
MAX_RESOLVE_TRACKS = 1000


class RegisterBody(BaseModel):
    device_id: str = Field(description="Client-generated stable device UUID")
    name: str = Field(description="Human-friendly device name, e.g. 'Chrome on Windows'")
    type: str = Field(description="Device type, e.g. 'desktop', 'phone', 'tablet'")


class PollBody(BaseModel):
    device_id: str = Field(description="This device's id")
    known_version: int = Field(0, description="Highest session version the client has already applied")
    client_sent_ms: int = Field(0, description="Client clock at send time (for Cristian offset estimation)")
    volume: float | None = Field(None, description="This device's local volume 0..1, if it changed")
    mute: bool | None = Field(None, description="This device's local mute state, if it changed")


class CommandBody(BaseModel):
    device_id: str = Field(description="Originating device id")
    type: str = Field(description="Command type (transport or targeted)")
    payload: dict[str, Any] = Field(default_factory=dict, description="Command-specific payload")
    target_device: str | None = Field(None, description="Target device id (required for targeted commands)")


class QueueSetBody(BaseModel):
    device_id: str = Field(description="Sending device id (must be a session member)")
    trackhashes: list[str] = Field(description="Full ordered queue of track hashes")
    from_: dict[str, Any] = Field(alias="from", description="The client's 'from' descriptor for the queue")
    currentindex: int = Field(description="Index of the current track within the queue")
    playing: bool = Field(description="Whether playback should be playing after the swap")
    position_ms: int = Field(0, description="Playhead position of the current track")
    repeat: str = Field("all", description="Repeat mode ('all' / 'one' / 'off')")


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
    manager.touch(userid, body.device_id, body.volume, body.mute)
    return manager.snapshot(userid, body.device_id, body.known_version)


@api.post("/command")
def command(body: CommandBody):
    """
    Route a transport (global) or targeted command into the session core.

    Transport types are scheduled LEAD_MS in the future and bump the version;
    targeted types execute immediately on their target and require ``target_device``.
    ``track_change`` is validated against the current queue bounds.
    """
    userid = get_current_userid()
    ctype = body.type

    if ctype in TRANSPORT_TYPES:
        payload = dict(body.payload)

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

        cmd = manager.apply_transport(userid, body.device_id, ctype, payload)
    elif ctype in TARGETED_TYPES:
        if not body.target_device:
            return {"msg": "target_device is required for targeted commands."}, 400
        cmd = manager.apply_targeted(userid, body.device_id, ctype, dict(body.payload), body.target_device)
    else:
        return {"msg": f"Unknown command type: {ctype!r}."}, 400

    if cmd is None:
        return {"msg": "Command rejected: no active session or invalid target."}, 400

    return {"command": cmd}


@api.post("/queue-set")
def queue_set(body: QueueSetBody):
    """
    Replace the session queue (the first joiner seeds the session with its local
    state). Schedules an implicit ``track_change`` and bumps the version.
    """
    userid = get_current_userid()

    trackhashes = body.trackhashes
    if len(trackhashes) > MAX_QUEUE_TRACKS:
        return {"msg": f"Too many trackhashes (max {MAX_QUEUE_TRACKS})."}, 400

    currentindex = max(0, min(body.currentindex, len(trackhashes) - 1)) if trackhashes else 0

    cmd = manager.set_queue(
        userid,
        body.device_id,
        trackhashes,
        body.from_,
        currentindex,
        body.playing,
        body.position_ms,
        body.repeat,
    )
    if cmd is None:
        return {"msg": "Cannot set queue: device is not a session member."}, 400

    return {"command": cmd}


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
