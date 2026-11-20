"""
Carry plays that point at no track over to the track their file holds now.

A play is counted under the trackhash its file had when it was logged, and a
trackhash is made of title, album and artists. A tag change gives the file a
new one. Today every path that changes a hash carries the references along
(the tag editor and the album apply in `lib/reference_migration.py`, a rescan in
`lib/index.py::_carry_references`, the name cleanup in `lib/name_cleanup.py`).
Plays from before those existed did not move: the repair round of July 2026
(placeholder tags, the album rename after the folder that matched nothing until
#442) left 1199 plays of 269 tracks on hashes no file carries any more. "Almost
complete", "Never played" and every other row that asks "heard?" saw those
tracks as unplayed.

Every play stores the path of its file (`extra.filepath`, `lib/extras.py`), so
the way back is the one a rescan takes: old hash -> the hash the file at that
path carries now, by the rules of `rescan_remap.remap_pairs` (an old hash
another file still holds stays; one spread over two files follows neither; a
file that is gone moves nothing). Playlists, favourites and ratings that hold
the same old hash move with the plays.

Limit, the same as the rescan's: the path is the only witness. A file that was
deleted and whose path a different song took later hands that song its plays.
A title check cannot tell the two apart, because a retag is exactly a new title
on the same path ("Track 19" -> "Say It Ain't So").

Reads first and writes only what is orphaned: once moved, the next start
finds nothing. Never raises, a start must not fail over it.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from aivinnet.lib.rescan_remap import remap_pairs

log = logging.getLogger(__name__)


def carry_orphaned_plays(tracks: Iterable[Any] | None = None) -> int:
    """
    Move the references of every orphaned play to its file's current hash.

    Call after `TrackStore.load_all_tracks` (and after `carry_cleaned_names`,
    which handles the hashes the model still knows) and before the plays are
    mapped onto the stores. Returns how many old hashes moved.
    """
    try:
        return _carry(tracks)
    except Exception:
        log.exception("Could not carry orphaned plays over to their tracks; will retry on the next start")
        return 0


def _carry(tracks: Iterable[Any] | None) -> int:
    from sqlalchemy import func, select

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import ScrobbleTable
    from aivinnet.lib.reference_migration import migrate_track_references_many

    if tracks is None:
        from aivinnet.store.tracks import TrackStore

        tracks = TrackStore.get_flat_list()

    after = {track.filepath: track.trackhash for track in tracks}
    present = set(after.values())

    with DbEngine.manager() as session:
        logged = session.execute(
            select(ScrobbleTable.trackhash, func.json_extract(ScrobbleTable.extra, "$.filepath")).distinct()
        ).all()

    orphaned = [(path, trackhash) for trackhash, path in logged if path and trackhash not in present]
    mapping = remap_pairs(orphaned, after)

    if mapping:
        migrate_track_references_many(mapping)
        log.info(
            "Carried the plays of %d track(s) from hashes no file holds to their file's current hash", len(mapping)
        )

    return len(mapping)
