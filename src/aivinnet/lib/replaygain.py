"""
ReplayGain tags for the player (#643).

The client evens out the loudness between tracks from the gain the files carry
in their tags (`client/src/utils/replayGain.ts`). It reads them from
`Track.extra`, where the indexer puts every tag it does not sort in itself
(`taglib.get_tags`); tinytag 2 already reads ReplayGain from FLAC, Ogg and MP3
and Opus' R128 gain.

A file is only read again when it changes, though, so the rows indexed before
tinytag 2 lack these tags even where the files have them. `start_backfill`
reads them once, in the background after the library is loaded, and marks
every row it has read (`CHECKED_KEY`), with or without a gain, so the next
start reads nothing. New rows carry the mark from the indexer.

The rules are pure, for the fast test lane; the database and the stores are
imported where they are used.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterable, Mapping
from typing import Any

log = logging.getLogger(__name__)

REPLAYGAIN_KEYS = (
    "replaygain_track_gain",
    "replaygain_track_peak",
    "replaygain_album_gain",
    "replaygain_album_peak",
    "r128_track_gain",
    "r128_album_gain",
)

# Set on every row whose file has been read for ReplayGain, found or not.
CHECKED_KEY = "replaygain_read"

# Rows per transaction: small enough that a stop never waits long on one.
BATCH = 200


def replaygain_tags(fields: Mapping[str, Any]) -> dict[str, list[str]]:
    """
    The ReplayGain tags among `fields` (tinytag's `as_dict()`), as tinytag 2
    gives every tag: a list of strings. Keys in lower case, empty ones dropped.
    """
    found: dict[str, list[str]] = {}
    for key, value in fields.items():
        name = str(key).lower()
        if name not in REPLAYGAIN_KEYS:
            continue
        values = value if isinstance(value, list) else [value]
        texts = [str(v).strip() for v in values if v is not None and str(v).strip()]
        if texts:
            found[name] = texts
    return found


def needs_reading(extra: Mapping[str, Any] | None) -> bool:
    """Whether a row has never been read for ReplayGain."""
    if not extra:
        return True
    return CHECKED_KEY not in extra and not any(key in extra for key in REPLAYGAIN_KEYS)


def with_replaygain(extra: Mapping[str, Any] | None, found: Mapping[str, list[str]]) -> dict[str, Any]:
    """`extra` with the tags found and the mark that the file has been read."""
    merged = dict(extra or {})
    merged.update(found)
    merged[CHECKED_KEY] = ["1"]
    return merged


def pending(tracks: Iterable[Any]) -> list[Any]:
    """The tracks still to read, one per file (a hash's twins are rows of their own)."""
    seen: set[str] = set()
    todo = []
    for track in tracks:
        if track.filepath in seen or not needs_reading(track.extra):
            continue
        seen.add(track.filepath)
        todo.append(track)
    return todo


def _read(filepath: str) -> dict[str, list[str]] | None:
    """The file's ReplayGain tags, or None when it cannot be read now."""
    from tinytag import TinyTag

    try:
        return replaygain_tags(TinyTag.get(filepath).as_dict())
    except Exception:
        # Gone, unreadable or not audio: no mark, so a later start tries again.
        return None


def backfill(tracks: Iterable[Any] | None = None) -> int:
    """
    Read the ReplayGain tags of every row that lacks them, write them to the
    database and onto the loaded tracks. Stops between batches when the server
    shuts down. Returns how many files carried a gain.
    """
    from aivinnet.db.libdata import TrackTable
    from aivinnet.utils.shutdown import WRITERS

    if tracks is None:
        from aivinnet.store.tracks import TrackStore

        tracks = TrackStore.get_flat_list()

    todo = pending(tracks)
    if not todo:
        return 0

    log.info("Reading ReplayGain tags of %d files", len(todo))
    tagged = 0

    for start in range(0, len(todo), BATCH):
        if WRITERS.stopping():
            log.info("ReplayGain reading stopped for the shutdown; the rest follows on the next start")
            break

        updates: dict[int, dict[str, Any]] = {}
        for track in todo[start : start + BATCH]:
            found = _read(track.filepath)
            if found is None:
                continue
            tagged += bool(found)
            updates[track.id] = with_replaygain(track.extra, found)

        if not updates:
            continue

        # A stop waits for the write in hand rather than closing the database
        # under it. The check sits inside `active()`: a stop asked for before
        # this point is seen here, one asked for after it waits for the write.
        with WRITERS.active():
            if WRITERS.stopping():
                log.info("ReplayGain reading stopped for the shutdown; the rest follows on the next start")
                break
            TrackTable.set_extras(updates)

        # The store answers the client; the database only the next start.
        for track in todo[start : start + BATCH]:
            if track.id in updates:
                track.extra = updates[track.id]

    log.info("ReplayGain tags read: %d files carry a gain", tagged)
    return tagged


def start_backfill() -> None:
    """Run `backfill` in a daemon thread; it must never fail a start."""

    def run() -> None:
        try:
            backfill()
        except Exception:
            log.exception("Could not read the ReplayGain tags; will retry on the next start")

    threading.Thread(target=run, name="replaygain", daemon=True).start()
