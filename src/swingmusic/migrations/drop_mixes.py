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

from sqlalchemy import text

from swingmusic.db.engine import DbEngine
from swingmusic.utils.mix_cleanup import (
    SQL_COUNT_MIXES,
    SQL_DROP_TABLE,
    SQL_FIND_TABLE,
    SQL_UNLABEL_SCROBBLES,
)

# `swingmusic.logger.log` is None until `setup_logger()` has run, and migrations
# also get called from a shell against a copy of a database — where that global
# is never set. A module logger works in both.
log = logging.getLogger(__name__)


def drop_mix_data() -> dict[str, int]:
    """
    Drop the `mix` table and unlabel scrobbles that pointed at a mix.

    Returns a small report so the caller can log what happened. The statements
    themselves live in `utils/mix_cleanup.py` — see there for why they are not
    in this file.
    """

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
