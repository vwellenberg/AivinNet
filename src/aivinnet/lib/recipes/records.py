"""
The records board on the stats page (#540), counted by the cron.

One pass over a user's whole history is too much for the request thread (the
server answers one request at a time, see `.claude/rules/api-endpoints.md`), so
the board is counted hourly and at start, and the stats page reads it from RAM.
A play since the last count shows up with the next run. The milestone check of
#545 does not wait for it: it counts on every play (`ScrobbleTable.plays_of`).
"""

import logging

from aivinnet.db.userdata import ScrobbleTable, UserTable
from aivinnet.lib.records import Board, PlayRow, build_board

log = logging.getLogger(__name__)

_boards: dict[int, Board] = {}


def _stopping() -> bool:
    # Imported here, not at the top: `crons` imports this module.
    from aivinnet.crons import cron_stopping

    return cron_stopping()


def refresh_records() -> None:
    """Count every user's board again. Runs in the cron thread only."""
    for userid in [user.id for user in UserTable.get_all()]:
        if _stopping():
            return

        rows = [PlayRow(*row) for row in ScrobbleTable.records_rows(userid)]
        _boards[userid] = build_board(rows)

        if not rows:
            log.info("records: no plays for user %s", userid)


def board_of(userid: int) -> Board | None:
    """The user's board as last counted, None before the first count (a user with no plays)."""
    return _boards.get(userid)


def forget(userid: int) -> None:
    """Drop a deleted user's board: SQLite gives their id to the next user created."""
    _boards.pop(userid, None)
