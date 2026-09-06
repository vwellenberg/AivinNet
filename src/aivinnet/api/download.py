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


# Names that carry no information and are better left out than printed.
UNINFORMATIVE_ARTISTS = {"", "unknown", "unknown artist", "various artists", "va"}

# Windows refuses these outright; the rest of the world only mostly minds.
ILLEGAL_IN_FILENAMES = r'<>:"/\|?*'

# Long enough for "Composed by Adam Sporka - Kingdom Come Deliverance II
# Extended Official Soundtrack - 6-001 Fistcuffs 1 (Extended Version)", short
# enough to survive a few nested directories on Windows' 260-character limit.
MAX_STEM = 150


def _artist_name(track) -> str:
    """
    The album artist, or nothing.

    Accepts both shapes this field takes: the RAM store hands out a plain
    string, while the model declares a list of dicts. Guessing one of them
    wrong would put "[{'name':" into a filename.
    """
    raw = getattr(track, "albumartists", None) or getattr(track, "artists", None)

    if isinstance(raw, str):
        name = raw
    elif isinstance(raw, (list, tuple)) and raw:
        first = raw[0]
        name = first.get("name", "") if isinstance(first, dict) else str(first)
    else:
        name = ""

    name = name.strip()

    return "" if name.lower() in UNINFORMATIVE_ARTISTS else name


def _sanitise(part: str) -> str:
    """Make one component safe for a filename on every platform we ship to."""
    cleaned = "".join("_" if c in ILLEGAL_IN_FILENAMES or ord(c) < 32 else c for c in part)

    return " ".join(cleaned.split()).strip(" .")


def download_filename(track, original: Path) -> str:
    """
    Name a downloaded file after its TAGS, not after the file on disk.

    The server used to send the on-disk name, and those carry no context in a
    real library: `swamp.mp3`, `Drum Loop 03.mp3`, `Main Theme (Piano).mp3`.
    Ten of them in a phone's Downloads folder and none says what it belongs to,
    while the tags knew all along.

    Whatever the tags do not have is left out rather than filled with a
    placeholder — plenty of game soundtracks have no album artist, and
    "Unknown - …" is noise. With nothing usable at all, the original name is
    kept: a worse name is still better than an empty one.
    """
    artist = _sanitise(_artist_name(track))
    album = _sanitise(getattr(track, "album", "") or "")
    title = _sanitise(getattr(track, "title", "") or "")

    if not title:
        return original.name

    number = getattr(track, "track", 0) or 0
    numbered = f"{number:02d} {title}" if number else title

    stem = " - ".join(part for part in (artist, album, numbered) if part)[:MAX_STEM].strip(" .")

    return f"{stem}{original.suffix}" if stem else original.name


def _unique(name: str, taken: set[str]) -> str:
    """
    Keep archive entries distinct.

    Two tracks can share a title and a number — alternate takes, a disc split
    the tags do not record — and a zip with two identical entry names unpacks to
    one file.
    """
    if name not in taken:
        taken.add(name)
        return name

    stem, _, suffix = name.rpartition(".")
    stem = stem or name

    for n in range(2, 1000):
        candidate = f"{stem} ({n}).{suffix}" if suffix else f"{stem} ({n})"
        if candidate not in taken:
            taken.add(candidate)
            return candidate

    taken.add(name)
    return name


def _existing_files(tracks) -> list[tuple[object, Path]]:
    """
    The tracks whose files are actually on disk, in the order given.

    The TRACK travels alongside its path because the archive entry is named
    after its tags — the name on disk is not the name that goes in.
    """
    pairs = [(t, Path(t.filepath)) for t in tracks]
    return [(t, p) for t, p in pairs if p.exists()]


def _too_large(entries: list[tuple[object, Path]]) -> tuple[bool, int, int]:
    """
    Whether these files exceed the configured archive limit.

    Measured BEFORE anything is built, from sizes we can stat cheaply — the
    point is to refuse early rather than to notice halfway through writing
    several gigabytes.
    """
    limit = max(0, UserConfig().maxDownloadSizeMB) * 1024 * 1024
    total = sum(p.stat().st_size for _t, p in entries)

    return (limit > 0 and total > limit), total, limit


def _zip_response(entries: list[tuple[object, Path]], download_name: str):
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

    # The noqa is on purpose: this handle has to OUTLIVE the function.
    # `send_file` reads from it while the response is being sent, so a context
    # manager would close it before the first byte goes out.
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)  # noqa: SIM115

    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as zf:
            taken: set[str] = set()

            for track, p in entries:
                # Named after the tags, not after the file on disk — the
                # names in a real library carry no context (`swamp.mp3`,
                # `Drum Loop 03.mp3`), and an archive of those is a puzzle.
                zf.write(p, _unique(download_filename(track, p), taken))

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
        # Only the name the browser saves changes; the file read from disk is
        # still addressed by its real path.
        download_name=download_filename(track, filepath),
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

    entries = _existing_files(tracks)
    oversized, total, limit = _too_large(entries)

    if oversized:
        return _refuse_oversized(total, limit)

    return _zip_response(entries, f"{safe_name}.zip")


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

    entries = _existing_files(tracks)
    oversized, total, limit = _too_large(entries)

    if oversized:
        return _refuse_oversized(total, limit)

    return _zip_response(entries, f"{safe_name}.zip")
