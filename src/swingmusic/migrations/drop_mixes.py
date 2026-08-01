"""
Removes what the mixes feature left behind in the database.

The feature itself is gone (the plugin, the cron, the routes, the model). What
survived a code-only removal is data: the `mix` table with its rows, and the
scrobbles whose `source` says a track was played from a mix. Both are now
unreadable — nothing left in the app knows what a mix is — so they are dropped
rather than kept as sediment.

Two different jobs, deliberately kept apart:

- The **table** is dropped whole. It has no readers left.
- The **scrobbles** are not deleted; only their `source` is cleared. They are
  real listening history — the track was played, and that fact belongs in the
  stats. Only the label saying WHERE it was played from has become meaningless.
  Measured before writing this: 4 rows out of 12490.

Safe to run repeatedly: the drop is `IF EXISTS`, and the scrobble update only
matches rows that still carry a `mix:` source, so a second run finds nothing.
"""

import logging

# NOTE: sqlalchemy and the db layer are imported INSIDE the function, not here.
# The unit-test lane runs with sqlalchemy replaced by a MagicMock, and importing
# `swingmusic.db` under that mock builds its declarative Base from the mock's
# metaclass — the module is then poisoned for the rest of the session with a
# "metaclass conflict" on every later import. Keeping this module's top level
# free of the ORM is what lets a test read the statements below at all.

# `swingmusic.logger.log` is None until `setup_logger()` has run, and migrations
# also get called from a shell against a copy of a database — where that global
# is never set. A module logger works in both.
log = logging.getLogger(__name__)

# The statements as data, so a test can check WHAT they do without importing the
# database layer. That constraint is real: the unit-test lane runs with sqlalchemy
# mocked out, and a test that reaches for a connection takes the whole ORM with it
# (`test_albumhash_collapse.py` says the same thing about its own migration).
#
# The distinction below is the one worth guarding: the table is DROPPED, the
# scrobbles are only UNLABELLED. Turning that second statement into a DELETE
# would silently shorten the listening history.
SQL_FIND_TABLE = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mix'"
SQL_COUNT_MIXES = "SELECT COUNT(*) FROM mix"
SQL_DROP_TABLE = "DROP TABLE IF EXISTS mix"
SQL_UNLABEL_SCROBBLES = "UPDATE scrobble SET source = '' WHERE source LIKE 'mix:%'"


def drop_mix_data() -> dict[str, int]:
    """
    Drop the `mix` table and unlabel scrobbles that pointed at a mix.

    Returns a small report so the caller can log what happened.
    """
    from sqlalchemy import text

    from swingmusic.db.engine import DbEngine

    report = {"mixes": 0, "scrobbles_unlabelled": 0}

    with DbEngine.manager(commit=True) as conn:
        table_exists = conn.execute(text(SQL_FIND_TABLE)).first()

        if table_exists:
            report["mixes"] = conn.execute(text(SQL_COUNT_MIXES)).scalar() or 0
            conn.execute(text(SQL_DROP_TABLE))

        # The scrobble table is the one place a removed feature can still make a
        # visible mess: the stats read `source` to say what a play came from.
        result = conn.execute(text(SQL_UNLABEL_SCROBBLES))
        report["scrobbles_unlabelled"] = result.rowcount or 0

    if report["mixes"] or report["scrobbles_unlabelled"]:
        log.info(
            "Dropped the mixes leftovers: %s mix rows removed, %s scrobbles unlabelled",
            report["mixes"],
            report["scrobbles_unlabelled"],
        )

    return report
