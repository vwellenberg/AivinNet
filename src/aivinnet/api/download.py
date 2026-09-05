"""Download endpoints for tracks and albums."""

import tempfile
import zipfile
from pathlib import Path

from flask import after_this_request, send_file, send_from_directory
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import AlbumHashSchema, TrackHashSchema
from aivinnet.config import UserConfig
from aivinnet.db.userdata import PlaylistTable
from aivinnet.store.tracks import TrackStore

bp_tag = Tag(name="Download", description="Download audio files")
api = APIBlueprint("download", __name__, url_prefix="/download", abp_tags=[bp_tag])


def _existing_files(tracks) -> list[Path]:
    """The track files that are actually on disk, in the order given."""
    paths = [Path(t.filepath) for t in tracks]
    return [p for p in paths if p.exists()]


def _too_large(paths: list[Path]) -> tuple[bool, int, int]:
    """
    Whether these files exceed the configured archive limit.

    Measured BEFORE anything is built, from sizes we can stat cheaply — the
    point is to refuse early rather than to notice halfway through writing
    several gigabytes.
    """
    limit = max(0, UserConfig().maxDownloadSizeMB) * 1024 * 1024
    total = sum(p.stat().st_size for p in paths)

    return (limit > 0 and total > limit), total, limit


def _zip_response(paths: list[Path], download_name: str):
    """
    Stream a ZIP of these files back, building it on DISK rather than in memory.

    ⚠️ This used to assemble the archive in an `io.BytesIO` — the whole album in
    RAM before a single byte went out. With ZIP_STORED the buffer is roughly the
    sum of the files, so one click on a 4 GB album asked for 4 GB, and a playlist
    had no natural bound at all. The limit above caps it, but a cap alone would
    still mean "that much RAM at once", and this ships for the Raspberry Pi.

    The temp file is unlinked immediately after opening: on POSIX the open
    descriptor keeps the data alive until the response has been sent, so there is
    nothing left to clean up even if the transfer fails or the process dies. On
    Windows the unlink fails while the file is open, so it is deleted after the
    response instead.
    """

    # reads from it while the response is being sent, so a context manager
    # would close it before the first byte goes out.
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115

    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as zf:
            for p in paths:
                zf.write(p, p.name)

        tmp.flush()
        tmp.seek(0)
    except BaseException:
        tmp.close()
        Path(tmp.name).unlink(missing_ok=True)
        raise

    try:
        Path(tmp.name).unlink()
    except OSError:
        # Windows: cannot unlink an open file. Clean up once the response is out.
        @after_this_request
        def _cleanup(response):
            try:
                Path(tmp.name).unlink(missing_ok=True)
            except OSError:
                pass
            return response

    return send_file(
        tmp,
        mimetype="application/zip",
        as_attachment=True,
        download_name=download_name,
    )


def _refuse_oversized(total: int, limit: int):
    return {
        "msg": (
            f"That download is {total // 1024 // 1024} MB, over the "
            f"{limit // 1024 // 1024} MB limit. Raise maxDownloadSizeMB in "
            f"settings, or download the tracks individually."
        )
    }, 413


@api.get("/track/<trackhash>")
def download_track(path: TrackHashSchema):
    """Download a single track file."""
    group = TrackStore.trackhashmap.get(path.trackhash)
    if not group:
        return {"msg": "Track not found"}, 404

    track = group.get_best()
    filepath = Path(track.filepath)

    if not filepath.exists():
        return {"msg": "File not found on disk"}, 404

    return send_from_directory(
        filepath.parent,
        filepath.name,
        as_attachment=True,
        download_name=filepath.name,
    )


@api.get("/album/<albumhash>")
def download_album(path: AlbumHashSchema):
    """Download all tracks in an album as a ZIP file."""
    tracks = [
        group.get_best() for group in TrackStore.trackhashmap.values() if group.get_best().albumhash == path.albumhash
    ]

    if not tracks:
        return {"msg": "Album not found"}, 404

    tracks.sort(key=lambda t: (t.disc, t.track))

    album_name = tracks[0].album or path.albumhash
    safe_name = "".join(c if c.isalnum() or c in " -_." else "_" for c in album_name)

    paths = _existing_files(tracks)
    oversized, total, limit = _too_large(paths)

    if oversized:
        return _refuse_oversized(total, limit)

    return _zip_response(paths, f"{safe_name}.zip")


class PlaylistIDPath(BaseModel):
    playlist_id: int = Field(description="The playlist ID")


@api.get("/playlist/<playlist_id>")
def download_playlist(path: PlaylistIDPath):
    """Download all tracks in a playlist as a ZIP file."""
    playlist = PlaylistTable.get_by_id(path.playlist_id)
    if playlist is None:
        return {"msg": "Playlist not found"}, 404

    tracks = [TrackStore.trackhashmap[h].get_best() for h in playlist.trackhashes if h in TrackStore.trackhashmap]

    if not tracks:
        return {"msg": "Playlist is empty"}, 404

    safe_name = "".join(c if c.isalnum() or c in " -_." else "_" for c in (playlist.name or "playlist"))

    paths = _existing_files(tracks)
    oversized, total, limit = _too_large(paths)

    if oversized:
        return _refuse_oversized(total, limit)

    return _zip_response(paths, f"{safe_name}.zip")
