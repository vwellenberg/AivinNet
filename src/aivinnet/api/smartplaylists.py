"""
Smart playlists: a set of rules instead of a list of tracks.

The rules are stored; the tracks are evaluated on every read against the
library and the caller's own plays. There is deliberately no add, remove or
move for them. The one way to keep a set of tracks is "save as playlist",
which freezes what the rules hold now into a normal playlist.
"""

import time
from typing import Any

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import GenericLimitSchema
from aivinnet.api.playlist import insert_playlist
from aivinnet.db.userdata import PlaylistTable, SmartPlaylistTable
from aivinnet.lib.smart_playlist_tracks import tracks_of
from aivinnet.lib.smart_playlists import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    Definition,
    definition_to_json,
    parse_definition,
)
from aivinnet.serializers.track import serialize_tracks
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid

tag = Tag(name="Smart playlists", description="Playlists made of rules, evaluated against the library")
api = APIBlueprint("smartplaylists", __name__, url_prefix="/smartplaylists", abp_tags=[tag])


class RuleBody(BaseModel):
    # Loosely typed on purpose: a wrong field or operator is a 400 with a
    # message from the rules module, not a bare 422 from the framework.
    field: str = Field(
        ..., description="genre, artist, albumartist, year, playcount, date_added, last_played or favorite"
    )
    op: str = Field(..., description="The operator for the field, e.g. is, contains, between, in_last_days")
    value: Any = Field(
        None,
        description="Text, a number, [low, high] for between, true or false for favorite, none for never",
    )


class SmartPlaylistBody(BaseModel):
    name: str = Field(..., description="The name of the smart playlist")
    match: str = Field("all", description='"all" or "any" of the rules must match')
    rules: list[RuleBody] = Field(..., description="The rules; at least one")
    limit: int = Field(DEFAULT_LIMIT, description=f"The most tracks to hold, 1 to {MAX_LIMIT}")
    sort: dict[str, Any] | str | None = Field(
        None,
        description='"random", or {"field": <field>, "order": "asc" | "desc"}; default: newest added first',
    )


class SmartPlaylistIDPath(BaseModel):
    smartid: int = Field(..., description="The ID of the smart playlist")


class SaveAsPlaylistBody(BaseModel):
    name: str = Field(..., description="The name of the new, normal playlist")


class GetSmartPlaylistQuery(GenericLimitSchema):
    start: int = Field(0, description="The index of the first track to return", ge=0)


def _definition_of(body: SmartPlaylistBody) -> Definition:
    return parse_definition(
        {
            "match": body.match,
            "rules": [rule.model_dump() for rule in body.rules],
            "limit": body.limit,
            "sort": body.sort,
        }
    )


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    # `row["rules"]` is the canonical definition: match, rules, limit, sort.
    return {"id": row["id"], "name": row["name"], **row["rules"], "created": row["created"], "updated": row["updated"]}


@api.get("")
def list_smart_playlists():
    """
    All smart playlists

    The rules only: no tracks are evaluated for the list.
    """
    rows = SmartPlaylistTable.list_of(get_current_userid())
    return {"data": [_summary(row) for row in rows]}


@api.post("/new")
def create_smart_playlist(body: SmartPlaylistBody):
    """
    New smart playlist

    Every check runs before the row is written: a bad rule answers 400 and
    leaves nothing behind.
    """
    name = body.name.strip()
    if not name:
        return {"error": "Name must not be empty"}, 400

    try:
        definition = _definition_of(body)
    except ValueError as error:
        return {"error": str(error)}, 400

    userid = get_current_userid()
    if SmartPlaylistTable.name_taken(userid, name):
        return {"error": "Smart playlist already exists"}, 409

    canonical = definition_to_json(definition)
    now = int(time.time())
    smartid = SmartPlaylistTable.add_one(userid, name, canonical, now)

    return {"playlist": {"id": smartid, "name": name, **canonical, "created": now, "updated": now}}, 201


@api.get("/<smartid>")
def get_smart_playlist(path: SmartPlaylistIDPath, query: GetSmartPlaylistQuery):
    """
    Get smart playlist

    Its rules, and the tracks it holds right now: `count` is all of them,
    `tracks` is the page `start` / `limit` asks for (-1 for the rest).
    """
    userid = get_current_userid()
    row = SmartPlaylistTable.get_of(path.smartid, userid)
    if row is None:
        return {"msg": "Playlist not found"}, 404

    try:
        definition = parse_definition(row["rules"])
    except ValueError as error:
        return {"error": str(error)}, 400

    trackhashes = tracks_of(userid, definition, seed=str(path.smartid))
    total = len(trackhashes)
    limit = total if query.limit == -1 else query.limit
    page = trackhashes[query.start : query.start + limit]

    # A list, so the store keeps the order of the page.
    tracks = TrackStore.get_tracks_by_trackhashes(page)

    return {
        "info": {**_summary(row), "count": total},
        "tracks": serialize_tracks(tracks),
    }


@api.put("/<smartid>/update", methods=["PUT"])
def update_smart_playlist(path: SmartPlaylistIDPath, body: SmartPlaylistBody):
    """
    Update smart playlist

    Replaces the name and the rules. Nothing is written before the name and
    the rules have been checked.
    """
    userid = get_current_userid()
    row = SmartPlaylistTable.get_of(path.smartid, userid)
    if row is None:
        return {"error": "Playlist not found"}, 404

    name = body.name.strip()
    if not name:
        return {"error": "Name must not be empty"}, 400

    try:
        definition = _definition_of(body)
    except ValueError as error:
        return {"error": str(error)}, 400

    if SmartPlaylistTable.name_taken(userid, name, exclude_id=path.smartid):
        return {"error": "Smart playlist already exists"}, 409

    canonical = definition_to_json(definition)
    now = int(time.time())
    SmartPlaylistTable.update_of(path.smartid, userid, {"name": name, "rules": canonical, "updated": now})

    return {"playlist": {"id": path.smartid, "name": name, **canonical, "created": row["created"], "updated": now}}, 200


@api.delete("/<smartid>/delete", methods=["DELETE"])
def remove_smart_playlist(path: SmartPlaylistIDPath):
    """
    Delete smart playlist

    Only the rules go; tracks in a playlist saved from it are a normal playlist's.
    """
    userid = get_current_userid()
    if SmartPlaylistTable.get_of(path.smartid, userid) is None:
        return {"msg": "Playlist not found"}, 404

    SmartPlaylistTable.remove_of(path.smartid, userid)
    return {"msg": "Done"}, 200


@api.post("/<smartid>/save-as-playlist")
def save_smart_playlist_as_playlist(path: SmartPlaylistIDPath, body: SaveAsPlaylistBody):
    """
    Save as playlist

    Freezes the tracks the rules hold now into a normal playlist, which then
    takes edits like any other. The smart playlist itself stays as it is.
    """
    userid = get_current_userid()
    row = SmartPlaylistTable.get_of(path.smartid, userid)
    if row is None:
        return {"msg": "Playlist not found"}, 404

    name = body.name.strip()
    if not name:
        return {"error": "Name must not be empty"}, 400

    if PlaylistTable.check_exists_by_name(name):
        return {"error": "Playlist already exists"}, 409

    try:
        definition = parse_definition(row["rules"])
    except ValueError as error:
        return {"error": str(error)}, 400

    trackhashes = tracks_of(userid, definition, seed=str(path.smartid))
    if not trackhashes:
        return {"error": "No tracks match this smart playlist"}, 400

    playlist = insert_playlist(name)
    if playlist is None:
        return {"error": "Playlist could not be created"}, 500

    try:
        PlaylistTable.append_to_playlist(playlist.id, trackhashes)
    except Exception:
        # Nothing empty is left behind (the same rule as save-item, #82).
        PlaylistTable.remove_one(playlist.id)
        raise

    playlist.count = len(trackhashes)
    return {"playlist": playlist}, 201
