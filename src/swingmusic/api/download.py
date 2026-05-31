"""Download endpoints for tracks and albums."""

import io
import zipfile
from pathlib import Path

from flask import send_file, send_from_directory
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from swingmusic.api.apischemas import AlbumHashSchema, TrackHashSchema
from swingmusic.db.userdata import PlaylistTable
from swingmusic.store.tracks import TrackStore

bp_tag = Tag(name="Download", description="Download audio files")
api = APIBlueprint("download", __name__, url_prefix="/download", abp_tags=[bp_tag])


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

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for track in tracks:
            fp = Path(track.filepath)
            if fp.exists():
                zf.write(fp, fp.name)

    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{safe_name}.zip",
    )


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

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for track in tracks:
            fp = Path(track.filepath)
            if fp.exists():
                zf.write(fp, fp.name)

    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{safe_name}.zip",
    )
