"""
Track editing routes.
"""

import os

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.auth import admin_required
from aivinnet.lib import library_lock, mbjobs
from aivinnet.lib.track_edit import AmbiguousTrackError, TrackNotFoundError, edit_track_tags, resolve_track
from aivinnet.lib.track_rename import name_after_tags, rename_files
from aivinnet.serializers.track import serialize_track
from aivinnet.utils.auth import get_current_userid
from aivinnet.utils.shutdown import WRITERS

# NOTE: blueprint name must be unique — stream.py already registers one named "track".
tag = Tag(name="Track", description="Edit track metadata")
api = APIBlueprint("trackedit", __name__, url_prefix="/track", abp_tags=[tag])


class TrackHashPath(BaseModel):
    trackhash: str = Field(..., description="The trackhash of the track to edit")


class EditTagsBody(BaseModel):
    title: str | None = Field(None, description="New track title")
    album: str | None = Field(None, description="New album title")
    artists: list[str] | None = Field(None, description="New list of track artists")
    albumartists: list[str] | None = Field(None, description="New list of album artists")
    track: int | None = Field(None, description="New track number", ge=0)
    # Not a tag: WHICH file. A trackhash is shared by every file with the same
    # title/album/artists (X.mp3 next to X.wav), so it cannot name one alone.
    filepath: str | None = Field(
        None, description="The file to edit; required when several files share the trackhash (else 409)"
    )
    # Not a tag: what to do with the FILE once the tags are written (#144).
    rename_file: bool = Field(False, description="Also name the file after the new tags ('03 - Title.mp3')")


def _rename_after_edit(track) -> dict:
    """
    Name the file after the tags just written. Never fails the request.

    The tags are on disk by the time this runs, and a name that is taken does
    not undo them — so the outcome is reported next to the track instead of
    as an error: the edit the person asked for happened, the rename did not.
    """
    name = name_after_tags(track)
    if name is None:
        return {"error": "The tags give no usable file name"}
    if name == os.path.basename(track.filepath):
        return {"name": name, "unchanged": True}

    applied, failed = rename_files([(track.filepath, name)])
    if failed:
        return {"error": failed[0]["error"]}

    result = {"name": name}
    if applied[0].get("warning"):
        result["warning"] = applied[0]["warning"]
    return result


@api.put("/<trackhash>/tags")
@admin_required()
def edit_tags(path: TrackHashPath, body: EditTagsBody):
    """
    Edit a track's metadata tags.

    Writes the new tags to the audio file, reindexes the track and repoints
    playlist/favorite/history references to the track's new identity (editing
    title/album/artist changes the trackhash). Returns the updated track.

    The trackhash is not unique (same title/album/artists = same hash, e.g.
    `X.mp3` next to `X.wav`). When several files share it, `filepath` must name
    the one to edit; without it the request is refused with 409 and the
    candidates in `filepaths`, and nothing is written. The returned track's
    `filepath` is always the file that was written.

    With `rename_file`, the file is then named after the new tags; how that went
    is in `rename` (a rename that could not happen does not undo the tags).

    ⚠️ The write runs as a JOB (#376): it backs the whole audio file up first,
    and in the request that copy held every listener (the server answers one
    request at a time) — seconds for a large WAV on a slow disk. What can be
    answered from RAM is answered here: no fields (400), a busy library (409
    `busy`), an unknown hash (404), several files and no path (409
    `filepaths`). Otherwise the answer is `{"job": id}`; poll
    `/metadata/job/<id>` for `{"track", "rename"?}` or the error.

    Admin only — this rewrites files on disk and migrates references for all users.
    """
    fields = body.model_dump(exclude_none=True, exclude={"rename_file", "filepath"})

    if not fields:
        return {"error": "No fields to update"}, 400

    # Refused at once while a rescan runs, as before; the job itself then waits
    # for one that starts in between instead of failing.
    try:
        with library_lock.try_hold():
            pass
    except library_lock.LibraryBusy as e:
        return {"error": str(e), "busy": True}, 409

    try:
        target = resolve_track(path.trackhash, body.filepath)
    except AmbiguousTrackError as e:
        return {"error": str(e), "filepaths": e.filepaths}, 409
    except TrackNotFoundError:
        return {"error": "Track not found"}, 404

    trackhash, filepath, rename = path.trackhash, target.filepath, body.rename_file
    # The favourite flag is per user, and the job has no current user.
    userid = get_current_userid()
    job_id = mbjobs.create()
    mbjobs.spawn(job_id, lambda: _run_edit(trackhash, fields, filepath, rename, userid), writes=True)
    return {"job": job_id}


def _run_edit(trackhash: str, fields: dict, filepath: str, rename: bool, userid: int) -> dict:
    """The worker. An error (`TrackEditError` …) ends the job with its message."""
    with library_lock.hold(), WRITERS.active():
        track = edit_track_tags(trackhash, fields, filepath)
        result: dict = {}
        if rename:
            # Before serialising: a successful rename moves `track.filepath`.
            result["rename"] = _rename_after_edit(track)

    result["track"] = serialize_track(track, userid=userid)
    return result
