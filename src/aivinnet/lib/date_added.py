"""
When a file came into the library — which is not when it was last written.

"Recently added" and "Date added" used the mtime (`last_mod`). Every tag edit,
every cover written into a file and every album apply sets that to now, so a
folder of music known for years, freshly repaired, came up on Home as "NEW
MUSIC". Since then each row carries `added` (migrations/track_added.py): the
mtime when the file is first indexed, and from then on carried over every
rewrite of the row — the rescan of a changed file (`tagger.IndexTracks`) and a
tag edit in the app (`track_edit`).

The rows that predate the column only have their mtime, which may already be
such a rewrite. `backfill_added` fills them once, after the library is loaded:
with the mtime, unless the track was played before it. A play proves the file
was there, so the mtime is a later rewrite. A rewritten track nobody has played
yet keeps the rewrite as its date; nothing in the database knows better.

The rule is pure (`first_seen`) so the fast test lane can run it; the database
work imports its dependencies lazily.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from typing import Any

log = logging.getLogger(__name__)


def first_seen(tracks: Iterable[Any], first_plays: Mapping[str, int]) -> dict[int, int]:
    """
    row id -> its earliest play, for the tracks played before their mtime.

    Every other track was added at its mtime, as far as anything can tell.
    Plays are logged per trackhash, so every file of a hash takes them: the MP3
    and WAV twins of 100-Musicians were repaired together, and only one of each
    pair is ever played. A twin really copied in later is dated with the song.
    """
    seen: dict[int, int] = {}

    for track in tracks:
        played = first_plays.get(track.trackhash)
        if played and played < track.last_mod:
            seen[track.id] = played

    return seen


def backfill_added(tracks: Iterable[Any] | None = None) -> int:
    """
    Fill `added` for the rows that have none yet, in the database and on `tracks`.

    Call after `TrackStore.load_all_tracks` and after `carry_cleaned_names`
    (plays must sit on the hashes the store uses), and before the albums and
    artists are built: their `created_date` is the earliest `added`. Reads one
    column when there is nothing to do. Never raises: a start must not fail over
    a date it can fill next time. Returns how many tracks got an earlier date
    than their mtime.
    """
    try:
        return _backfill(tracks)
    except Exception:
        log.exception("Could not fill in when the tracks were added; will retry on the next start")
        return 0


def _backfill(tracks: Iterable[Any] | None) -> int:
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.userdata import ScrobbleTable

    unknown = TrackTable.ids_without_added()
    if not unknown:
        return 0

    if tracks is None:
        from aivinnet.store.tracks import TrackStore

        tracks = TrackStore.get_flat_list()

    pending = [t for t in tracks if t.id in unknown]
    seen = first_seen(pending, ScrobbleTable.first_play_by_trackhash())

    # The store first: should the write fail, this run still has the dates.
    # Every other pending track already holds its mtime (`Track.__post_init__`).
    for track in pending:
        if track.id in seen:
            track.added = seen[track.id]

    TrackTable.fill_added(seen)
    log.info(
        "Filled in when %d tracks were added; %d of them were played before their file was last written",
        len(unknown),
        len(seen),
    )
    return len(seen)
