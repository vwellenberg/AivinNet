"""
The server's calling card, shown above the results of the search "aivin" (#547).

Numbers only, no names: the version, the uptime, what the library holds, the
plays of all users together, and the oldest play, which says since when this
installation runs.

Everything here is RAM. The request thread is single (bjoern), so the card never
reads the database on a request: the two database figures live in
`SERVER_TOTALS`. The cron loop fills them at startup and hourly
(`crons/__init__.py`), and every logged play adds to them in place
(`api/scrobble`). Between a fill and the next one, a play deleted or restored
off the request path is only seen at the next fill.
"""

import threading
import time
from typing import Any

# When this process started, near enough: this module loads with the app.
STARTED_AT = time.time()


class ServerTotals:
    """Plays of all users and the oldest play, kept in RAM. `None` until the first fill."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._plays: int | None = None
        self._oldest: int | None = None

    def fill(self, plays: int, oldest: int | None) -> None:
        """Replace both with the database's figures."""
        with self._lock:
            self._plays = plays
            self._oldest = oldest

    def note_play(self, timestamp: int) -> None:
        """
        A play was logged: count it, and let it be the oldest if it is.

        Before the first fill there is nothing to add to, and the fill counts it.
        """
        with self._lock:
            if self._plays is None:
                return
            self._plays += 1
            if self._oldest is None or timestamp < self._oldest:
                self._oldest = timestamp

    def snapshot(self) -> tuple[int | None, int | None]:
        """`(plays, oldest play)`, both `None` before the first fill."""
        with self._lock:
            return self._plays, self._oldest


SERVER_TOTALS = ServerTotals()


def build_card(
    *,
    version: str,
    started_at: float,
    now: float,
    tracks: int,
    albums: int,
    artists: int,
    plays: int | None,
    since: int | None,
) -> dict[str, Any]:
    """
    The card as the search answers it. `uptime` is whole seconds since the
    process started; a clock that runs backwards reads as 0, not negative.
    """
    return {
        "version": version,
        "uptime": max(0, int(now - started_at)),
        "tracks": tracks,
        "albums": albums,
        "artists": artists,
        "plays": plays,
        "since": since,
    }
