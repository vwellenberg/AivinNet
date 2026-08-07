"""
Album/playlist cover art endpoints.

Three ways to give an album a cover — search iTunes/Deezer for it, upload a
local file, or take the one it has and write it into the audio files — plus the
way to take a wrong one away again. Playlists keep their own upload path in
``api/playlist.py``; only their online search lives here.
"""

from io import BytesIO

from flask_openapi3 import APIBlueprint, Tag
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from aivinnet import models
from aivinnet.api.auth import admin_required
from aivinnet.api.formfields import FileStorage
from aivinnet.db.userdata import PlaylistTable
from aivinnet.lib import album_cover_edit, playlistlib
from aivinnet.lib import coverart as coverartlib
from aivinnet.lib.album_cover_edit import AlbumCoverError, embed_album_cover
from aivinnet.store.albums import AlbumStore
from aivinnet.utils.dates import create_new_date, date_string_to_time_passed

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
    Restore the album cover that was replaced by the last save or removal
    (one level).
    """
    if AlbumStore.albummap.get(body.albumhash) is None:
        return {"error": "Album not found"}, 404

    if not coverartlib.undo_album_cover(body.albumhash):
        return {"error": "Nothing to undo"}, 404

    return {"success": True}


@api.post("/album/remove")
def remove_album_cover(body: AlbumHashBody):
    """
    Remove an album's cover so it falls back to the placeholder.

    Deletes the four thumbnail sizes plus the image server's derived cache and
    records the removal, which is what stops the folder cover / embedded art
    from being re-derived on the next request or library scan. Revertible once
    via /coverart/album/undo.
    """
    if AlbumStore.albummap.get(body.albumhash) is None:
        return {"error": "Album not found"}, 404

    coverartlib.remove_album_cover(body.albumhash)

    return {"success": True}


class UploadAlbumCoverForm(BaseModel):
    albumhash: str = Field(..., description="The album hash")
    # Plain FileStorage, never a union — see api/formfields.py.
    image: FileStorage = Field(..., description="The cover image file")


@api.post("/album/upload")
def upload_album_cover(form: UploadAlbumCoverForm):
    """
    Save an uploaded image file as the album's cover in all thumbnail sizes.

    The local-file counterpart to POST /coverart/album, which takes a URL. Both
    end in the same persistence helper, so both are revertible via
    /coverart/album/undo.
    """
    if AlbumStore.albummap.get(form.albumhash) is None:
        return {"error": "Album not found"}, 404

    try:
        # Read one byte past the cap so an oversized upload is recognisable;
        # same ceiling the URL-based save applies to its downloads.
        content = form.image.read(coverartlib.MAX_DOWNLOAD_BYTES + 1)
    except OSError:
        return {"error": "Image could not be read"}, 400

    if not content:
        return {"error": "Image is empty"}, 400

    if len(content) > coverartlib.MAX_DOWNLOAD_BYTES:
        return {"error": "Image is too large"}, 400

    filename = coverartlib.save_album_cover_bytes(form.albumhash, content)
    if not filename:
        return {"error": "Failed: Invalid image"}, 400

    # Changing a cover changes the files too — no second action to remember.
    # Background, because the server is single-threaded and rewriting a
    # 30-track album inline would hold the whole app still.
    album_cover_edit.write_cover_through(form.albumhash)

    return {"success": True, "image": filename}


@api.post("/album/embed")
@admin_required()
def embed_album_cover_in_files(body: AlbumHashBody):
    """
    Write the album's current cover into every one of its audio files.

    Opt-in only: this rewrites files in the user's library. Each file is backed
    up before it is written and restored if the write fails; containers with no
    cover-art slot are reported as failures rather than skipped silently.

    Admin only — same reason as the tag editor: it mutates files on disk.
    """
    if AlbumStore.albummap.get(body.albumhash) is None:
        return {"error": "Album not found"}, 404

    try:
        result = embed_album_cover(body.albumhash)
    except AlbumCoverError as e:
        return {"error": str(e)}, 400

    return result


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

    # See the upload route: a deliberate cover change writes through to the
    # files. The MusicBrainz BATCH deliberately does not — it changes hundreds
    # of albums at once, and rewriting thousands of files off one button press
    # is a different thing from changing one album's picture.
    album_cover_edit.write_cover_through(body.albumhash)

    return {"success": True, "image": filename}
