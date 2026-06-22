"""
Track editing routes.
"""

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from swingmusic.api.auth import admin_required
from swingmusic.lib.track_edit import TrackEditError, TrackNotFoundError, edit_track_tags
from swingmusic.serializers.track import serialize_track

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


@api.put("/<trackhash>/tags")
@admin_required()
def edit_tags(path: TrackHashPath, body: EditTagsBody):
    """
    Edit a track's metadata tags.

    Writes the new tags to the audio file, reindexes the track and repoints
    playlist/favorite/history references to the track's new identity (editing
    title/album/artist changes the trackhash). Returns the updated track.

    Admin only — this rewrites files on disk and migrates references for all users.
    """
    fields = body.model_dump(exclude_none=True)

    if not fields:
        return {"error": "No fields to update"}, 400

    try:
        track = edit_track_tags(path.trackhash, fields)
    except TrackNotFoundError:
        return {"error": "Track not found"}, 404
    except TrackEditError as e:
        return {"error": str(e)}, 400

    return {"track": serialize_track(track)}
