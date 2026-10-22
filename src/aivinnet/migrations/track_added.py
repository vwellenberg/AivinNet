"""
Adds `track.added`, the time a file came into the library.

"Recently added" and every "Date added" sort read `last_mod`, the file's mtime.
That is the time the file was last WRITTEN: a tag edit, a cover written into the
file, an album apply all set it to now, and the next scan re-reads the file as a
new row. A folder of long-known music whose tags were repaired showed up on Home
as "NEW MUSIC", ahead of anything really new. `last_mod` stays what it is — the
scan's "has this file changed?" — and `added` is carried over every rewrite
(`IndexTracks`, `track_edit`).

The column comes in empty (NULL) for the rows that are already there, and
`lib/date_added.backfill_added` fills it once the library is loaded. Only there are
the live trackhashes known, and with them the earliest play, which is the one
evidence that a file was in the library before its mtime says.

⚠️ Runs from `setup_sqlite()`, before anything selects the track table: the
SELECT of `TrackTable.get_all` names every mapped column, and on a database
without this one it fails with `no such column: track.added`. Idempotent by
inspection (`PRAGMA table_info`), like `user_token_version.py`.
"""

import logging

from sqlalchemy import text

from aivinnet.db.engine import DbEngine

log = logging.getLogger(__name__)

COLUMN = "added"
TABLE = "track"


def _has_column(session) -> bool:
    rows = session.execute(text(f"PRAGMA table_info({TABLE})")).fetchall()
    # PRAGMA table_info returns (cid, name, type, notnull, dflt_value, pk).
    return any(row[1] == COLUMN for row in rows)


def add_track_added_column() -> None:
    """Give the track table its `added` column, empty for existing rows. Safe to call on every start."""
    with DbEngine.manager(commit=True) as session:
        if _has_column(session):
            return

        # Nullable on purpose: NULL is "not known yet", and the backfill tells
        # it apart from a value that was carried over.
        session.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} INTEGER"))

    log.info("Added %s.%s — a tag edit no longer makes a file recently added", TABLE, COLUMN)
