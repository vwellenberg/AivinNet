"""Download endpoints for tracks and albums."""

import unicodedata
import zipfile
from pathlib import Path
from urllib.parse import quote

from flask import Response, send_from_directory
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import AlbumHashSchema, TrackHashSchema
from aivinnet.config import UserConfig
from aivinnet.db.userdata import PlaylistTable
from aivinnet.store.albums import AlbumStore
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


# What one turn of the generator copies. bjoern takes one chunk per pass of its
# event loop and handles the other connections in the same pass; a request
# needs a few passes (accept, read, answer), so another listener waits a few
# chunks' worth of copying — milliseconds, where it was the whole archive.
# Measured on ryukyu with a 0.1 s chunk: a second request answered in 0.4 s
# while a 2 s body was still going out.
CHUNK = 256 * 1024


class _Sink:
    """Collects what ZipFile writes until the generator hands it on."""

    def __init__(self) -> None:
        self._parts: list[bytes] = []

    def write(self, data) -> int:
        self._parts.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        data = b"".join(self._parts)
        self._parts.clear()
        return data


def _zip_chunks(entries: list[tuple[object, Path]]):
    """
    The ZIP of these files, produced while it is being sent.

    The sink cannot seek, so ZipFile writes each entry's sizes and CRC in a data
    descriptor after its bytes — the standard way to stream an archive.
    `ZipInfo.from_file` still knows each size up front, which is what decides
    whether an entry needs ZIP64.
    """
    sink = _Sink()

    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED) as zf:
        taken: set[str] = set()

        for track, p in entries:
            # Named after the tags, not after the file on disk — the names in a
            # real library carry no context (`swamp.mp3`, `Drum Loop 03.mp3`),
            # and an archive of those is a puzzle.
            try:
                info = zipfile.ZipInfo.from_file(p, _unique(download_filename(track, p), taken))
                src = p.open("rb")
            except OSError:
                # Gone since the size check. Leave it out: nothing of it is in
                # the archive yet, and failing here would cut the download off.
                continue

            info.compress_type = zipfile.ZIP_STORED

            with src, zf.open(info, "w") as dest:
                while chunk := src.read(CHUNK):
                    dest.write(chunk)
                    yield sink.take()

            yield sink.take()  # the entry's data descriptor

    yield sink.take()  # the central directory, written on close


def _zip_response(entries: list[tuple[object, Path]], download_name: str):
    """
    Send a ZIP of these files, built while it is being sent.

    ⚠️ It was built first — in an `io.BytesIO` once (the whole album in RAM),
    then in a temp file — and only then sent. Either way the archive was written
    INSIDE the request, and the server answers one request at a time: a 900 MB
    soundtrack stalled every listener's playback for as long as copying it took
    (#295). Now each turn of the generator copies one CHUNK and bjoern serves the
    other connections in between. Memory stays at one chunk, and there is no
    temp file to clean up when a transfer dies halfway.
    """
    response = Response(_zip_chunks(entries), mimetype="application/zip")
    response.headers.set("Content-Disposition", "attachment", **_disposition_name(download_name))
    return response


def _disposition_name(name: str) -> dict[str, str]:
    """`filename`, plus RFC 5987 `filename*` for a name that is not ASCII (as `send_file` does)."""
    try:
        name.encode("ascii")
    except UnicodeEncodeError:
        simple = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
        return {"filename": simple, "filename*": f"UTF-8''{quote(name, safe='!#$&+^`|~')}"}

    return {"filename": name}


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
    # From the album's own track list: walking every group of the library for
    # its members was a full pass on the request thread (#295).
    entry = AlbumStore.albummap.get(path.albumhash)
    tracks = [
        t
        for t in TrackStore.get_tracks_by_trackhashes(entry.trackhashes if entry else ())
        if t.albumhash == path.albumhash
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
