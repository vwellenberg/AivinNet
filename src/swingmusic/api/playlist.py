"""
All playlist-related routes.
"""

import json
import pathlib
from typing import Any

from flask_openapi3 import APIBlueprint, Tag
from flask_openapi3 import FileStorage as _FileStorage
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, GetCoreSchemaHandler
from pydantic_core import core_schema

from swingmusic import models
from swingmusic.api.apischemas import GenericLimitSchema
from swingmusic.db.userdata import PlaylistTable
from swingmusic.lib import playlistlib
from swingmusic.lib.albumslib import sort_by_track_no
from swingmusic.lib.home.recentlyadded import get_recently_added_playlist
from swingmusic.lib.home.recentlyplayed import get_recently_played_playlist
from swingmusic.lib.playlist_maintenance import prune_orphan_trackhashes
from swingmusic.lib.sortlib import sort_tracks
from swingmusic.models.playlist import Playlist
from swingmusic.serializers.playlist import serialize_for_card
from swingmusic.serializers.track import serialize_tracks
from swingmusic.settings import Paths
from swingmusic.store.tracks import TrackStore
from swingmusic.utils.dates import create_new_date, date_string_to_time_passed

tag = Tag(name="Playlists", description="Get and manage playlists")
api = APIBlueprint("playlists", __name__, url_prefix="/playlists", abp_tags=[tag])


def insert_playlist(name: str, image: str | None = None):
    playlist = {
        "image": image,
        "last_updated": create_new_date(),
        "name": name,
        "trackhashes": [],
        "settings": {
            "has_gif": False,
            "banner_pos": 50,
            "square_img": True if image else False,
            "pinned": False,
        },
    }

    rowid = PlaylistTable.add_one(playlist)
    if rowid:
        playlist["id"] = rowid
        return Playlist(**playlist)

    return None


def get_path_trackhashes(path: str, tracksortby: str, reverse: bool):
    """
    Returns a list of trackhashes in a folder.
    """
    tracks = TrackStore.get_tracks_in_path(path)
    tracks = sort_tracks(tracks, key=tracksortby, reverse=reverse)
    return [t.trackhash for t in tracks]


def get_album_trackhashes(albumhash: str):
    """
    Returns a list of trackhashes in an album.
    """
    tracks = TrackStore.get_tracks_by_albumhash(albumhash)
    tracks = sort_by_track_no(tracks)

    return [t.trackhash for t in tracks]


def get_artist_trackhashes(artisthash: str):
    """
    Returns a list of trackhashes for an artist.
    """
    tracks = TrackStore.get_tracks_by_artisthash(artisthash)
    tracks = sort_tracks(tracks, key="playcount", reverse=True)
    return [t.trackhash for t in tracks]


def format_custom_playlist(playlist: models.Playlist, tracks: list[models.Track]):
    playlist.duration = sum(t.duration for t in tracks)
    playlist.count = len(tracks)

    return {
        "info": serialize_for_card(playlist),
        "tracks": serialize_tracks(tracks),
    }


class SendAllPlaylistsQuery(BaseModel):
    no_images: bool = Field(False, description="Whether to include images")


@api.get("")
def send_all_playlists(query: SendAllPlaylistsQuery):
    """
    Gets all the playlists.
    """
    playlists = PlaylistTable.get_all()
    playlists = sorted(
        playlists,
        key=lambda p: p.name.casefold(),
    )

    for playlist in playlists:
        if not playlist.has_image:
            playlist.images = playlistlib.get_first_4_images(trackhashes=playlist.trackhashes)

        playlist.clear_lists()

    # playlists.sort(
    #     key=lambda p: datetime.strptime(p.last_updated, "%Y-%m-%d %H:%M:%S"),
    #     reverse=True,
    # )

    return {"data": playlists}


class CreatePlaylistBody(BaseModel):
    name: str = Field(..., description="The name of the playlist")


@api.post("/new")
def create_playlist(body: CreatePlaylistBody):
    """
    New playlist

    Creates a new playlist. Accepts POST method with a JSON body.
    """
    exists = PlaylistTable.check_exists_by_name(body.name)

    if exists:
        return {"error": "Playlist already exists"}, 409

    playlist = insert_playlist(body.name)

    if playlist is None:
        return {"error": "Playlist could not be created"}, 500

    return {"playlist": playlist}, 201


class PlaylistIDPath(BaseModel):
    # INFO: playlistid string examples: "recentlyadded"
    playlistid: str = Field(..., description="The ID of the playlist")


class AddItemToPlaylistBody(BaseModel):
    itemtype: str = Field(
        default="tracks",
        description="The type of item to add",
        examples=["tracks", "folder", "album", "artist"],
    )
    sortoptions: dict = Field(
        default=None,
        description="The sort options for the tracks",
    )
    itemhash: str = Field(..., description="The hash of the item to add")


@api.post("/<playlistid>/add")
def add_item_to_playlist(path: PlaylistIDPath, body: AddItemToPlaylistBody):
    """
    Add to playlist.

    If itemtype is not "tracks", itemhash is expected to be a folder, album or artist hash.
    """
    itemtype = body.itemtype
    itemhash = body.itemhash
    playlist_id = int(path.playlistid)
    sortoptions = body.sortoptions

    if itemtype == "tracks":
        trackhashes = itemhash.split(",")
        if len(trackhashes) == 1 and trackhashes[0] in PlaylistTable.get_trackhashes(playlist_id):
            return {"msg": "Track already exists in playlist"}, 409
    elif itemtype == "folder":
        trackhashes = get_path_trackhashes(
            itemhash,
            sortoptions.get("tracksortby") or "default",
            sortoptions.get("tracksortreverse") or False,
        )
    elif itemtype == "album":
        trackhashes = get_album_trackhashes(itemhash)
    elif itemtype == "artist":
        trackhashes = get_artist_trackhashes(itemhash)
    else:
        trackhashes = []

    PlaylistTable.append_to_playlist(playlist_id, trackhashes)
    return {"msg": "Done"}, 200


class GetPlaylistQuery(GenericLimitSchema):
    no_tracks: bool = Field(False, description="Whether to include tracks")
    start: int = Field(0, description="The start index of the tracks")


@api.get("/<playlistid>")
def get_playlist(path: PlaylistIDPath, query: GetPlaylistQuery):
    """
    Get playlist by id
    """
    no_tracks = query.no_tracks
    playlistid = path.playlistid

    custom_playlists = [
        {"name": "recentlyadded", "handler": get_recently_added_playlist},
        {"name": "recentlyplayed", "handler": get_recently_played_playlist},
    ]
    is_custom = playlistid in {p["name"] for p in custom_playlists}

    if is_custom:
        if query.start != 0:
            return {
                "tracks": [],
            }

        handler = next(p["handler"] for p in custom_playlists if p["name"] == playlistid)
        playlist, tracks = handler()
        return format_custom_playlist(playlist, tracks)

    playlist = PlaylistTable.get_by_id(int(playlistid))

    if playlist is None:
        return {"msg": "Playlist not found"}, 404

    if query.limit == -1:
        # -1 means "all remaining tracks". Must be the full length: using
        # len - 1 dropped the LAST track (off-by-one), so e.g. a 5-track
        # playlist returned only 4 and the MCP/sort silently lost the last one.
        query.limit = len(playlist.trackhashes)

    tracks = TrackStore.get_tracks_by_trackhashes(playlist.trackhashes[query.start : query.start + query.limit])
    duration = sum(t.duration for t in tracks)
    playlist._last_updated = date_string_to_time_passed(playlist.last_updated)
    playlist.duration = duration
    playlist.images = playlistlib.get_first_4_images(tracks)
    playlist.clear_lists()

    return {
        "info": playlist,
        "tracks": serialize_tracks(tracks) if not no_tracks else [],
    }


class FileStorage(_FileStorage):
    @classmethod
    def __get_pydantic_core_schema__(cls, _source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_plain_validator_function(cls.validate)


class UpdatePlaylistForm(BaseModel):
    image: FileStorage = Field(description="The image file")
    name: str = Field(..., description="The name of the playlist")
    settings: str = Field(
        ...,
        description="The settings of the playlist",
        json_schema_extra={"example": '{"has_gif": false, "banner_pos": 50, "square_img": false, "pinned": false}'},
    )


@api.put("/<playlistid>/update", methods=["PUT"])
def update_playlist_info(path: PlaylistIDPath, form: UpdatePlaylistForm):
    """
    Update playlist
    """
    playlistid = path.playlistid
    db_playlist = PlaylistTable.get_by_id(playlistid)

    if db_playlist is None:
        return {"error": "Playlist not found"}, 404

    image = form.image

    if form.image:
        image = form.image

    settings = json.loads(form.settings)
    settings["has_gif"] = False

    playlist = {
        "id": int(playlistid),
        "image": db_playlist.image,
        "last_updated": create_new_date(),
        "name": str(form.name).strip(),
        "settings": settings,
    }

    if image:
        try:
            pil_image = Image.open(image)
            content_type = image.content_type

            playlist["image"] = playlistlib.save_p_image(pil_image, playlistid, content_type)

            if image.content_type == "image/gif":
                playlist["settings"]["has_gif"] = True

        except UnidentifiedImageError:
            return {"error": "Failed: Invalid image"}, 400

    p_tuple = (*playlist.values(),)

    PlaylistTable.update_one(playlistid, playlist)
    playlistlib.cleanup_playlist_images()

    playlist = models.Playlist(*p_tuple)
    playlist.last_updated = date_string_to_time_passed(playlist.last_updated)

    return {
        "data": playlist,
    }


@api.post("/<playlistid>/pin_unpin")
def pin_unpin_playlist(path: PlaylistIDPath):
    """
    Pin playlist.
    """
    playlist = PlaylistTable.get_by_id(path.playlistid)

    if playlist is None:
        return {"error": "Playlist not found"}, 404

    settings = playlist.settings

    try:
        settings["pinned"] = not settings["pinned"]
    except KeyError:
        settings["pinned"] = True

    PlaylistTable.update_settings(path.playlistid, settings)
    return {"msg": "Done"}, 200


class PlaylistPosition(BaseModel):
    id: int = Field(description="Playlist id")
    position: int = Field(description="New position in the shared sidebar order")


class ReorderPlaylistsBody(BaseModel):
    positions: list[PlaylistPosition] = Field(description="Explicit playlist positions")


@api.post("/sidebar-order")
def reorder_sidebar_playlists(body: ReorderPlaylistsBody):
    """
    Set each playlist's settings.position explicitly. Positions share one space
    with folder positions so folders and pinned playlists interleave freely in
    the library sidebar. Unlisted playlists keep their position.
    """
    for item in body.positions:
        playlist = PlaylistTable.get_by_id(item.id)
        if playlist is None:
            continue

        settings = playlist.settings
        settings["position"] = item.position
        PlaylistTable.update_settings(item.id, settings)

    return {"msg": "Done"}, 200


@api.delete("/<playlistid>/remove-img")
def remove_playlist_image(path: PlaylistIDPath):
    """
    Clear playlist image.
    """
    playlist = PlaylistTable.get_by_id(path.playlistid)

    if playlist is None:
        return {"error": "Playlist not found"}, 404

    PlaylistTable.remove_image(path.playlistid)

    playlist.image = None
    playlist.thumb = None
    playlist.settings["has_gif"] = False
    playlist.has_image = False

    playlist.images = playlistlib.get_first_4_images(trackhashes=playlist.trackhashes)
    playlist.last_updated = date_string_to_time_passed(playlist.last_updated)

    return {"playlist": playlist}, 200


@api.delete("/<playlistid>/delete", methods=["DELETE"])
def remove_playlist(path: PlaylistIDPath):
    """
    Delete playlist
    """
    # playlistid arrives as a string; remove_one expects an int (passing the
    # string raised a 500 and broke deletion entirely).
    try:
        pid = int(path.playlistid)
    except (TypeError, ValueError):
        return {"error": "Invalid playlist id"}, 400

    PlaylistTable.remove_one(pid)
    playlistlib.cleanup_playlist_images()
    return {"msg": "Done"}, 200


class RemoveTracksFromPlaylistBody(BaseModel):
    tracks: list[dict] = Field(..., description="A list of trackhashes to remove")


@api.post("/<playlistid>/remove-tracks")
def remove_tracks_from_playlist(path: PlaylistIDPath, body: RemoveTracksFromPlaylistBody):
    """
    Remove track from playlist
    """
    # A track looks like this:
    # {
    #    trackhash: str;
    #    index: int;
    # }

    PlaylistTable.remove_from_playlist(path.playlistid, body.tracks)

    return {"msg": "Done"}, 200


class ReorderTracksBody(BaseModel):
    trackhashes: list[str] = Field(..., description="The new ordered list of trackhashes")


@api.put("/<playlistid>/reorder")
def reorder_playlist_tracks(path: PlaylistIDPath, body: ReorderTracksBody):
    """
    Reorder playlist tracks
    """
    playlist = PlaylistTable.get_by_id(int(path.playlistid))

    if playlist is None:
        return {"error": "Playlist not found"}, 404

    PlaylistTable.update_one(int(path.playlistid), {"trackhashes": body.trackhashes})
    return {"msg": "Done"}, 200


@api.post("/<playlistid>/prune-orphans")
def prune_playlist_orphans(path: PlaylistIDPath):
    """
    Prune orphan trackhashes.

    Removes trackhashes that no longer resolve to a track in the library
    (e.g. the file was deleted or re-scanned to a different hash). These
    orphans inflate the playlist's count and can desync the UI. The order of
    the surviving tracks is preserved.

    Maintenance-only: this is the only place that drops hashes on purpose; the
    read path (GET) never mutates the stored list.
    """
    playlist = PlaylistTable.get_by_id(int(path.playlistid))

    if playlist is None:
        return {"error": "Playlist not found"}, 404

    # Safety: if the track store is empty (e.g. a library rescan just reset it
    # with `trackhashmap = dict()` and is still repopulating), EVERY hash would
    # look like an orphan and we'd wipe the playlist. Refuse rather than lose
    # data — the caller can retry once the store is loaded.
    if not TrackStore.trackhashmap:
        return {"error": "Track store not ready; try again shortly"}, 503

    original = playlist.trackhashes
    kept = prune_orphan_trackhashes(original, TrackStore.trackhashmap)
    removed = len(original) - len(kept)

    if removed:
        PlaylistTable.update_one(int(path.playlistid), {"trackhashes": kept})

    return {"msg": "Done", "removed": removed, "count": len(kept)}, 200


class RenamePlaylistBody(BaseModel):
    name: str = Field(..., description="The new playlist name")


@api.put("/<playlistid>/rename")
def rename_playlist(path: PlaylistIDPath, body: RenamePlaylistBody):
    """
    Rename a playlist (name only, no image upload). Convenience endpoint for
    automation / the MCP server; the form-based /update keeps the image flow.
    """
    db_playlist = PlaylistTable.get_by_id(int(path.playlistid))

    if db_playlist is None:
        return {"error": "Playlist not found"}, 404

    name = body.name.strip()
    if not name:
        return {"error": "Name must not be empty"}, 400

    PlaylistTable.update_one(int(path.playlistid), {"name": name, "last_updated": create_new_date()})
    return {"msg": "Done", "name": name}, 200


class SavePlaylistAsItemBody(BaseModel):
    itemtype: str = Field(..., description="The type of item", example="tracks")
    playlist_name: str = Field(..., description="The name of the playlist")
    itemhash: str = Field(..., description="The hash of the item to save")
    sortoptions: dict = Field(
        default=dict(),
        description="The sort options for the tracks",
    )


@api.post("/save-item")
def save_item_as_playlist(body: SavePlaylistAsItemBody):
    """
    Save as playlist

    Saves a track, album, artist or folder as a playlist
    """
    itemtype = body.itemtype
    playlist_name = body.playlist_name
    itemhash = body.itemhash
    sortoptions = body.sortoptions

    if PlaylistTable.check_exists_by_name(playlist_name):
        return {"error": "Playlist already exists"}, 409

    if itemtype == "tracks":
        trackhashes = itemhash.split(",")
    elif itemtype == "folder":
        trackhashes = get_path_trackhashes(
            itemhash,
            sortoptions.get("tracksortby") or "default",
            sortoptions.get("tracksortreverse") or False,
        )
    elif itemtype == "album":
        trackhashes = get_album_trackhashes(itemhash)
    elif itemtype == "artist":
        trackhashes = get_artist_trackhashes(itemhash)
    else:
        trackhashes = []

    if len(trackhashes) == 0:
        return {"error": "No tracks founds"}, 404

    image = itemhash + ".webp" if itemtype != "folder" and itemtype != "tracks" else None

    playlist = insert_playlist(playlist_name, image)

    if playlist is None:
        return {"error": "Playlist could not be created"}, 500

    # save image
    if itemtype != "folder" and itemtype != "tracks":
        filename = itemhash + ".webp"

        base_path = Paths().lg_artist_img_path if itemtype == "artist" else Paths().lg_thumb_path()
        img_path = pathlib.Path(base_path + "/" + filename)

        if img_path.exists():
            img = Image.open(img_path)
            playlistlib.save_p_image(img, str(playlist.id), "image/webp", filename=filename)

    PlaylistTable.append_to_playlist(playlist.id, trackhashes)
    playlist.count = len(trackhashes)

    images = playlistlib.get_first_4_images(trackhashes=trackhashes)
    playlist.images = [img["image"] for img in images]

    return {"playlist": playlist}, 201
