"""
"Find cover online" endpoints.

Search iTunes/Deezer for album artwork and save a confirmed suggestion as a
playlist image (existing playlist image pipeline) or as a custom album cover
(existing MusicBrainz cover pipeline).
"""

from io import BytesIO

from flask_openapi3 import APIBlueprint, Tag
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from swingmusic import models
from swingmusic.api.musicbrainz import _save_cover_bytes
from swingmusic.api.playlist import PlaylistIDPath
from swingmusic.db.userdata import PlaylistTable
from swingmusic.lib import coverart as coverartlib
from swingmusic.lib import playlistlib
from swingmusic.store.albums import AlbumStore
from swingmusic.utils.dates import create_new_date, date_string_to_time_passed

tag = Tag(name="Cover art", description="Search album covers online and apply them")
api = APIBlueprint("coverart", __name__, url_prefix="/coverart", abp_tags=[tag])


class CoverSearchQuery(BaseModel):
    q: str = Field(..., min_length=1, description="Free-text search query")
    limit: int = Field(30, ge=1, le=50, description="Maximum number of results")


@api.get("/search")
def search_covers(query: CoverSearchQuery):
    """
    Search iTunes and Deezer for album covers matching the query.
    Results are merged, deduped and cached briefly per query.
    """
    q = query.q.strip()
    if not q:
        return {"error": "Query is empty"}, 400

    return {"query": q, "results": coverartlib.search_covers(q, query.limit)}


class SaveCoverBody(BaseModel):
    url: str = Field(..., description="The confirmed cover image URL")


@api.post("/playlist/<playlistid>")
def save_playlist_cover(path: PlaylistIDPath, body: SaveCoverBody):
    """
    Download the confirmed cover server-side and save it as the playlist
    image via the existing playlist image pipeline.
    """
    db_playlist = PlaylistTable.get_by_id(path.playlistid)

    if db_playlist is None:
        return {"error": "Playlist not found"}, 404

    content = coverartlib.download_cover(body.url)
    if content is None:
        return {"error": "Image could not be downloaded"}, 400

    try:
        pil_image = Image.open(BytesIO(content))
    except UnidentifiedImageError:
        return {"error": "Failed: Invalid image"}, 400

    playlistid = path.playlistid
    filename = playlistlib.save_p_image(pil_image, playlistid)

    settings = db_playlist.settings
    settings["has_gif"] = False
    settings["square_img"] = True

    # Mirrors update_playlist_info: dict value order matches the
    # models.Playlist positional constructor.
    playlist = {
        "id": int(playlistid),
        "image": filename,
        "last_updated": create_new_date(),
        "name": db_playlist.name,
        "settings": settings,
    }

    p_tuple = (*playlist.values(),)

    PlaylistTable.update_one(playlistid, playlist)
    playlistlib.cleanup_playlist_images()

    playlist = models.Playlist(*p_tuple)
    playlist.last_updated = date_string_to_time_passed(playlist.last_updated)

    return {"data": playlist}


class SaveAlbumCoverBody(BaseModel):
    albumhash: str = Field(..., description="The album hash")
    url: str = Field(..., description="The confirmed cover image URL")


@api.post("/album")
def save_album_cover(body: SaveAlbumCoverBody):
    """
    Download the confirmed cover server-side and persist it as the album's
    cover in all thumbnail sizes (same pipeline as the MusicBrainz fetch).
    """
    if AlbumStore.albummap.get(body.albumhash) is None:
        return {"error": "Album not found"}, 404

    content = coverartlib.download_cover(body.url)
    if content is None:
        return {"error": "Image could not be downloaded"}, 400

    filename = _save_cover_bytes(body.albumhash, content)
    if not filename:
        return {"error": "Cover could not be saved"}, 400

    return {"success": True, "image": filename}
