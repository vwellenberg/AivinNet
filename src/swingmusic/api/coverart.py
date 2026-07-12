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
    Results are merged, deduped and cached briefly per query. When the full
    query has no hits, progressively shortened variants are tried; the
    response's `query` field is the variant that produced the results.
    """
    q = query.q.strip()
    if not q:
        return {"error": "Query is empty"}, 400

    used, results = coverartlib.search_covers_with_fallback(q, query.limit)
    return {"query": used, "results": results}


class SaveCoverBody(BaseModel):
    url: str = Field(..., description="The confirmed cover image URL")


class CoverPlaylistPath(BaseModel):
    # INFO: int (unlike the shared str-typed PlaylistIDPath): pseudo playlists
    # like "recentlyadded" have no stored image, so pydantic can reject them
    # with a validation error instead of a manual guard.
    playlistid: int = Field(..., description="The ID of the playlist")


@api.post("/playlist/<playlistid>")
def save_playlist_cover(path: CoverPlaylistPath, body: SaveCoverBody):
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
        filename = playlistlib.save_p_image(pil_image, path.playlistid)
    except (UnidentifiedImageError, OSError, ValueError):
        return {"error": "Failed: Invalid image"}, 400

    settings = db_playlist.settings
    settings["has_gif"] = False

    # Online covers are square album art: default new images to the square
    # layout, but never override a banner choice the user already made.
    if not db_playlist.has_image:
        settings["square_img"] = True

    playlist = {
        "id": path.playlistid,
        "image": filename,
        "last_updated": create_new_date(),
        "name": db_playlist.name,
        "settings": settings,
    }

    PlaylistTable.update_one(path.playlistid, playlist)
    playlistlib.cleanup_playlist_images()

    updated = models.Playlist(
        id=path.playlistid,
        image=filename,
        last_updated=date_string_to_time_passed(playlist["last_updated"]),
        name=db_playlist.name,
        settings=settings,
    )

    return {"data": updated}


class AlbumHashBody(BaseModel):
    albumhash: str = Field(..., description="The album hash")


@api.post("/album/undo")
def undo_album_cover(body: AlbumHashBody):
    """
    Restore the album cover that was replaced by the last save (one level).
    """
    if AlbumStore.albummap.get(body.albumhash) is None:
        return {"error": "Album not found"}, 404

    if not coverartlib.undo_album_cover(body.albumhash):
        return {"error": "Nothing to undo"}, 404

    return {"success": True}


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

    filename = coverartlib.save_album_cover_bytes(body.albumhash, content)
    if not filename:
        return {"error": "Cover could not be saved"}, 400

    return {"success": True, "image": filename}
