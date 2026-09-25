"""
Track editing routes.
"""

import os

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.auth import admin_required
from aivinnet.lib.track_edit import TrackEditError, TrackNotFoundError, edit_track_tags
from aivinnet.lib.track_rename import name_after_tags, rename_files
from aivinnet.serializers.track import serialize_track

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

    With `rename_file`, the file is then named after the new tags; how that went
    is in `rename` (a rename that could not happen does not undo the tags).

    Admin only — this rewrites files on disk and migrates references for all users.
    """
    fields = body.model_dump(exclude_none=True, exclude={"rename_file"})

    if not fields:
        return {"error": "No fields to update"}, 400

    try:
        track = edit_track_tags(path.trackhash, fields)
    except TrackNotFoundError:
        return {"error": "Track not found"}, 404
    except TrackEditError as e:
        return {"error": str(e)}, 400

    result: dict = {}
    if body.rename_file:
        # Before serialising: a successful rename moves `track.filepath`.
        result["rename"] = _rename_after_edit(track)

    result["track"] = serialize_track(track)
    return result
