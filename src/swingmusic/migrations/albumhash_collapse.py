"""
Repairs album hashes that collapsed into a single album.

Tracks whose file carries no album tag used to hash the EMPTY STRING as their
album, so every untagged file sharing an album artist landed in one album, with
one cover for all of them. Measured on a real library: 4043 tracks from 208
different folders in a single album.

`lib/taglib.py` now falls back to the track's folder instead, but that only
applies to files as they are scanned — and an incremental scan skips files whose
`last_mod` has not changed, which is all of them. Existing libraries therefore
need this one-time repair.

It is safe to run repeatedly: a track is only touched while its stored hash
still equals the broken one, so a second run finds nothing.
"""

import logging
from collections import defaultdict

from sqlalchemy import delete, select, update

from swingmusic.db.engine import DbEngine
from swingmusic.db.libdata import TrackTable
from swingmusic.db.userdata import FavoritesTable
from swingmusic.lib.albumhash import album_hash, broken_album_hash

# `swingmusic.logger.log` is None until `setup_logger()` has run. In the app it
# has, but this repair is also useful to call from a shell against a copy of a
# database — and there it crashed on the very last line, after the writes had
# already been committed. A stdlib logger is never None.
logger = logging.getLogger(__name__)


def repair_collapsed_albumhashes() -> dict[str, int]:
    """
    Re-points affected tracks at a per-folder album and cleans up favourites
    that referenced one of the collapsed albums.

    Returns a small report so the caller can log what happened.
    """
    report = {"tracks": 0, "albums": 0, "dropped_favorites": 0}

    with DbEngine.manager(commit=True) as conn:
        rows = conn.execute(
            select(
                TrackTable.id,
                TrackTable.albumartists,
                TrackTable.albumhash,
                TrackTable.folder,
            )
        ).all()

        updates: list[dict[str, str | int]] = []
        collapsed: set[str] = set()
        new_hashes: set[str] = set()

        for id_, albumartists, albumhash, folder in rows:
            if albumhash != broken_album_hash(albumartists):
                continue

            # No album tag, by definition of the signature above — so the
            # scanner's rule reduces to the folder fallback.
            new_hash = album_hash(None, folder, albumartists)

            # A single-folder collapse is already correct — re-hashing it would
            # only churn rows and invalidate favourites for no gain.
            if new_hash == albumhash:
                continue

            collapsed.add(albumhash)
            new_hashes.add(new_hash)
            updates.append({"track_id": id_, "new_hash": new_hash})

        if not updates:
            return report

        # One statement per resulting album rather than per track: a collapsed
        # bucket of 4000 tracks becomes a few hundred albums, so this is a few
        # hundred updates instead of a few thousand. Ids are chunked because
        # SQLite caps the number of bound parameters in an IN clause.
        by_hash: dict[str, list[int]] = defaultdict(list)

        for row in updates:
            by_hash[str(row["new_hash"])].append(int(row["track_id"]))

        for new_hash, ids in by_hash.items():
            for start in range(0, len(ids), 500):
                conn.execute(
                    update(TrackTable)
                    .where(TrackTable.id.in_(ids[start : start + 500]))
                    .values(albumhash=new_hash)
                )

        report["tracks"] = len(updates)
        report["albums"] = len(new_hashes)

        # A favourite or a pin that pointed at a collapsed album pointed at
        # something that never existed as an album — hundreds of unrelated
        # folders wearing one cover. There is no single album to move it to, so
        # it is removed rather than silently re-pointed at an arbitrary one.
        if collapsed:
            result = conn.execute(
                delete(FavoritesTable)
                .where(FavoritesTable.type.in_(["album", "pinned_album"]))
                .where(FavoritesTable.hash.in_(list(collapsed)))
            )
            report["dropped_favorites"] = result.rowcount or 0

    logger.info(
        "Repaired collapsed album hashes: %d tracks re-grouped into %d albums, %d favorites dropped",
        report["tracks"],
        report["albums"],
        report["dropped_favorites"],
    )

    return report
