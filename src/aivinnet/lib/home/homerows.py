"""
Pure rules behind the personal homepage rows "Continue listening", "Rediscover"
and "On this day".

Deliberately free of database and store imports: the routines in
`lib/recipes/homerows.py` read the scrobbles and resolve tracks, and hand the
results to these functions. That keeps the rules testable in the fast lane,
where `aivinnet.db` and the stores cannot be imported (see `.claude/rules/tests.md`).

Everything here is local: it works on the user's own scrobbles and library.
"""

from collections.abc import Callable, Iterable
from typing import Any, Protocol

import pendulum


class ScrobbleLike(Protocol):
    """The fields of `models.logger.TrackLog` these rules read."""

    trackhash: str
    timestamp: int
    type: str
    type_src: str | None


# How many of the newest scrobbles "Continue listening" looks back through.
# Bounded on purpose: the routine also runs from the scrobble request.
CONTINUE_SEARCH_LIMIT = 200

# "Rediscover": an album qualifies with at least this many plays over all time
# and none in the last QUIET_DAYS. 5 plays = more than one full listen of most
# EPs and a deliberate return to most albums; lower and every album that was
# once played through shows up.
REDISCOVER_MIN_PLAYS = 5
REDISCOVER_QUIET_DAYS = 60
ROW_LIMIT = 15

# Playlists the server builds on the fly (`create_items.custom_playlists`).
# They have no stable track order, so there is nothing to continue.
CUSTOM_PLAYLISTS = {"recentlyadded", "recentlyplayed"}


def find_continue_listening(
    scrobbles: Iterable[ScrobbleLike],
    resolve_tracklist: Callable[[str, str], list[str] | None],
) -> dict[str, Any] | None:
    """
    The album or playlist the user was in the middle of, newest first.

    `scrobbles` must be ordered newest first. Only plays started from an album
    (`al:<albumhash>`) or a playlist (`pl:<id>`) count. The NEWEST play of a
    source decides it: if that was the source's last track it is finished and
    skipped, and older plays from the same source are not looked at again —
    otherwise a finished album would come back with the position of an
    earlier, half-way listen.

    `resolve_tracklist(type, src)` returns the ordered trackhashes of the
    album/playlist, or None when it no longer exists.
    """
    decided: set[tuple[str, str]] = set()

    for scrobble in scrobbles:
        if scrobble.type not in ("album", "playlist") or not scrobble.type_src:
            continue

        source = (scrobble.type, scrobble.type_src)
        if source in decided:
            continue
        decided.add(source)

        if scrobble.type == "playlist" and scrobble.type_src in CUSTOM_PLAYLISTS:
            continue

        tracklist = resolve_tracklist(scrobble.type, scrobble.type_src)
        if not tracklist:
            continue

        try:
            index = tracklist.index(scrobble.trackhash)
        except ValueError:
            # The track left the album/playlist since — the position is unknown.
            continue

        if index >= len(tracklist) - 1:
            continue  # finished

        return {
            "type": scrobble.type,
            "hash": scrobble.type_src,
            # The track itself, not only its position: a playlist's stored
            # list can hold orphans (hashes no longer in the library) that the
            # client never receives, so `track_index` counted here can point
            # one or more tracks too far there. The client resumes by this
            # hash and falls back to the index.
            "trackhash": scrobble.trackhash,
            "track_index": index,
            "track_total": len(tracklist),
            "timestamp": scrobble.timestamp,
        }

    return None


def rank_rediscover(
    scrobbles: Iterable[ScrobbleLike],
    album_of: Callable[[str], str | None],
    now: float,
    min_plays: int = REDISCOVER_MIN_PLAYS,
    quiet_days: int = REDISCOVER_QUIET_DAYS,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, int, int]]:
    """
    Albums played often over all time but not in the last `quiet_days`.

    A play counts for the album the TRACK belongs to (like the Stats page's
    `get_albums_in_period`), no matter where it was started from.
    `album_of(trackhash)` maps a track to its albumhash, None if it is gone
    from the library.

    Returns `(albumhash, playcount, last_played_timestamp)`, most played first;
    ties go to the album played more recently.
    """
    cutoff = now - quiet_days * 86400
    counts: dict[str, int] = {}
    last: dict[str, int] = {}
    album_cache: dict[str, str | None] = {}

    for scrobble in scrobbles:
        trackhash = scrobble.trackhash
        if trackhash not in album_cache:
            album_cache[trackhash] = album_of(trackhash)

        albumhash = album_cache[trackhash]
        if albumhash is None:
            continue

        counts[albumhash] = counts.get(albumhash, 0) + 1
        if scrobble.timestamp > last.get(albumhash, 0):
            last[albumhash] = scrobble.timestamp

    ranked = [
        (albumhash, count, last[albumhash])
        for albumhash, count in counts.items()
        if count >= min_plays and last[albumhash] < cutoff
    ]
    ranked.sort(key=lambda r: (r[1], r[2]), reverse=True)
    return ranked[:limit]


def rediscover_item(albumhash: str, playcount: int, last_played: int) -> dict[str, Any]:
    """A homepage item for one `rank_rediscover` result."""
    month = pendulum.from_timestamp(last_played, tz=pendulum.local_timezone()).format("MMMM YYYY")

    return {
        "type": "album",
        "hash": albumhash,
        "help_text": f"{playcount} {'play' if playcount == 1 else 'plays'}",
        "secondary_text": f"last {month}",
    }


def on_this_day_window(now: pendulum.DateTime | None = None) -> tuple[int, int, str]:
    """
    Start and end (unix seconds, inclusive) of the same calendar day one year
    ago, plus its label, e.g. "4 October 2025".

    Server-local time, like `utils/dates.get_date_range` (`pendulum.now()`).
    On 29 February the day a year ago is the 28th (pendulum clamps).
    """
    now = now or pendulum.now()
    day = now.subtract(years=1)

    start = day.start_of("day")
    end = day.end_of("day")
    return int(start.timestamp()), int(end.timestamp()), day.format("D MMMM YYYY")
