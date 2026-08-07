"""
The SQL that clears out what the removed mixes feature left in the database.

Lives here rather than next to the migration that runs it, for the same reason
`lib/albumhash.py` holds the rule for the album-hash repair: `migrations/__init__.py`
imports the ORM, so anything inside that package drags the whole database layer
along — and the unit-test lane runs with sqlalchemy replaced by a MagicMock,
where that import poisons `swingmusic.db` with a metaclass conflict for the rest
of the session. Plain strings in a plain module can be read by a test.

The distinction between the two statements is the part worth guarding:

- the `mix` table is **dropped** — nothing can read it any more,
- the scrobbles are only **unlabelled** — the play happened, and that belongs in
  the listening history. Only the label saying WHERE it came from is meaningless
  now. Turning that into a DELETE would silently shorten the history.
"""

SQL_FIND_TABLE = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mix'"
SQL_COUNT_MIXES = "SELECT COUNT(*) FROM mix"
SQL_DROP_TABLE = "DROP TABLE IF EXISTS mix"
SQL_UNLABEL_SCROBBLES = "UPDATE scrobble SET source = '' WHERE source LIKE 'mix:%'"
