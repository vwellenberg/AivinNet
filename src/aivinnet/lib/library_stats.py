"""
The library tiles on the stats page (#536): what of the library the user has
explored, how long it runs nonstop, and what it is made of.

Pure rules over plain values, so the fast lane can test them. The API reads
the library from the RAM store and the heard set from ScrobbleTable, and caches
both; nothing here touches a file or the database.

- Explored: a track counts once, by trackhash (X.mp3 and X.wav are one track).
  It is heard when its trackhash is in the user's heard set. An album is
  explored once any of its tracks is heard.
- Nonstop: the lengths of the library's tracks, one per trackhash.
- Formats, mean bitrate and hi-res are per FILE, as they are on disk. A file is
  hi-res above `HIRES_SAMPLERATE` Hz or `HIRES_BITDEPTH` bits. A missing or
  unreadable tag value is 0, which is never hi-res.
"""

from collections import Counter
from collections.abc import Iterable, Mapping, Set
from pathlib import PurePosixPath
from typing import Any, NamedTuple

from aivinnet.utils.parsers import tag_int

# Above these, a file is hi-res (48 kHz and 16 bit are CD/DVD-era, not hi-res).
HIRES_SAMPLERATE = 48000
HIRES_BITDEPTH = 16


class LibraryFile(NamedTuple):
    """One file of the library, with what the tiles count from it."""

    trackhash: str
    albumhash: str
    duration: int
    bitrate: int
    format: str
    samplerate: int
    bitdepth: int


def library_file(
    trackhash: str,
    albumhash: str,
    duration: int,
    bitrate: int,
    filepath: str,
    extra: Mapping[str, object] | None,
) -> LibraryFile:
    """
    The facts of one file. `extra` is the raw tag dict (`Track.extra`), whose
    values can be numbers, strings or lists of strings, or be missing entirely.
    """
    values: Mapping[str, object] = extra or {}
    suffix = PurePosixPath(filepath).suffix.lstrip(".").upper()
    return LibraryFile(
        trackhash=trackhash,
        albumhash=albumhash,
        duration=max(int(duration or 0), 0),
        bitrate=max(int(bitrate or 0), 0),
        format=suffix or "UNKNOWN",
        samplerate=tag_int(values.get("samplerate"), 0),
        bitdepth=tag_int(values.get("bitdepth"), 0),
    )


def is_hires(samplerate: int, bitdepth: int) -> bool:
    """Hi-res: a sample rate above 48 kHz or a bit depth above 16."""
    return samplerate > HIRES_SAMPLERATE or bitdepth > HIRES_BITDEPTH


def library_totals(files: Iterable[LibraryFile]) -> dict[str, Any]:
    """
    The numbers that depend on the library alone: the nonstop length, the
    formats of its files, their mean bitrate and the hi-res share.

    Files without a known bitrate (0) are left out of the mean, not counted as
    zero. `nonstop_seconds` counts each trackhash once.
    """
    seconds = 0
    files_total = 0
    formats: Counter[str] = Counter()
    bitrate_sum = 0
    bitrate_count = 0
    hires = 0
    seen: set[str] = set()

    for file in files:
        files_total += 1
        formats[file.format] += 1

        if file.bitrate > 0:
            bitrate_sum += file.bitrate
            bitrate_count += 1

        if is_hires(file.samplerate, file.bitdepth):
            hires += 1

        if file.trackhash not in seen:
            seen.add(file.trackhash)
            seconds += file.duration

    shares = sorted(formats.items(), key=lambda item: (-item[1], item[0]))

    return {
        "nonstop_seconds": seconds,
        "files": files_total,
        "formats": [{"format": name, "files": count, "share": count / files_total} for name, count in shares],
        "mean_bitrate": round(bitrate_sum / bitrate_count) if bitrate_count else None,
        "hires": {
            "files": hires,
            "share": hires / files_total if files_total else None,
        },
    }


def explored(files: Iterable[LibraryFile], heard: Set[str]) -> dict[str, Any]:
    """
    How much of the library one user has heard: tracks by trackhash, albums by
    albumhash (an album is explored once any of its tracks is heard). `heard`
    is the user's trackhashes, which may hold tracks no longer in the library;
    those are left out.
    """
    tracks: set[str] = set()
    heard_tracks: set[str] = set()
    album_heard: dict[str, bool] = {}

    for file in files:
        if file.trackhash in tracks:
            continue
        tracks.add(file.trackhash)

        is_heard = file.trackhash in heard
        if is_heard:
            heard_tracks.add(file.trackhash)
        album_heard[file.albumhash] = album_heard.get(file.albumhash, False) or is_heard

    albums_heard = sum(1 for is_album_heard in album_heard.values() if is_album_heard)

    return {
        "tracks": _share(len(heard_tracks), len(tracks)),
        "albums": _share(albums_heard, len(album_heard)),
    }


def _share(heard: int, total: int) -> dict[str, Any]:
    return {"heard": heard, "total": total, "share": heard / total if total else None}
