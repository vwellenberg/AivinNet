"""
Adds `playlistfolder.pinned`: whether a playlist folder sits in the sidebar's
manually ordered zone (pinned) or among the alphabetical rest below it.

Until this column a folder was ALWAYS up top, like a pinned playlist without
the pin. The column comes in as 1 for every folder that exists, so an upgrade
changes nothing on screen; unpinning is a choice the user makes afterwards.

⚠️ Runs from `setup_sqlite()`, like `user_token_version.py` and
`track_added.py`: any SELECT of the table names every mapped column and fails
with `no such column: playlistfolder.pinned` on a database without it.
Idempotent by inspection (`PRAGMA table_info`).
"""

import logging

from sqlalchemy import text

from aivinnet.db.engine import DbEngine

log = logging.getLogger(__name__)

COLUMN = "pinned"
TABLE = "playlistfolder"


def add_playlistfolder_pinned_column() -> None:
    """Pin every existing playlist folder (= where it already is). Safe to call on every start."""
    with DbEngine.manager(commit=True) as session:
        columns = [row[1] for row in session.execute(text(f"PRAGMA table_info({TABLE})")).fetchall()]
        # No table (yet): `create_all` builds it with the column.
        if not columns or COLUMN in columns:
            return

        # NOT NULL with a constant default is an ALTER SQLite does in place.
        session.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} BOOLEAN NOT NULL DEFAULT 1"))

    log.info("Added %s.%s — playlist folders can now be unpinned", TABLE, COLUMN)
