"""
The Advent calendar on Home (1 to 24 December): one door a day, behind each
door an album of the user's own library they have not heard in a long time, or
never.

- Door `d` is the album at position `d - 1` of the year's order. The order is
  three tiers: albums not played for `QUIET_DAYS` first, then albums never
  played, then the rest, least recently played first. The first two tiers are
  shuffled with a seed of (userid, year): stable for the year, different for
  every user and every year.
- No album twice within one calendar, as long as the library has one left.
  Fewer albums than days: the calendar repeats, in the same order, and only
  then.
- A door decided once keeps its album (`made`): a play during the day moves
  the album out of its tier, and the door must not change under the user's
  hand. The routine that holds `made` lives in `lib/home/advent_calendar.py`.

Pure rules, like `recap.py`: no database, no stores. Testable in the fast lane,
strict under mypy.
"""

import random
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

DAY = 86400

ADVENT_MONTH = 12
ADVENT_DAYS = 24
# "Not heard in a long time": not played for this many days.
QUIET_DAYS = 180


@dataclass(frozen=True)
class AdventAlbum:
    albumhash: str
    # The album artists' hashes: an album is in the calendar unless every one
    # of them is a placeholder.
    artists: tuple[str, ...]
    # The user's plays of the album (a play counts for every edition of a track).
    plays: int = 0
    # Timestamp of the latest of those plays, 0 when there are none.
    last_played: int = 0


def advent_day(today: date) -> int:
    """The door of `today`, 1 to 24 in December, else 0 (no calendar)."""
    if today.month != ADVENT_MONTH or today.day > ADVENT_DAYS:
        return 0
    return today.day


def _seed(userid: int, year: int) -> int:
    """Stable across processes (`hash()` is not): one order per user and year."""
    return zlib.crc32(f"advent:{userid}:{year}".encode())


def advent_order(
    albums: Sequence[AdventAlbum],
    userid: int,
    year: int,
    now: float,
    skip: Callable[[str], bool] = lambda artisthash: False,
) -> list[str]:
    """
    Every album of the calendar, in the order its doors draw them: quiet
    (played before, not within `QUIET_DAYS`), never played, then the rest
    least recently played first. `skip(artisthash)` marks placeholder artists.
    """
    cutoff = now - QUIET_DAYS * DAY
    quiet: list[str] = []
    never: list[str] = []
    recent: list[AdventAlbum] = []

    for album in albums:
        if not album.artists or all(skip(artisthash) for artisthash in album.artists):
            continue
        if album.plays == 0:
            never.append(album.albumhash)
        elif album.last_played <= cutoff:
            quiet.append(album.albumhash)
        else:
            recent.append(album)

    rng = random.Random(_seed(userid, year))
    rng.shuffle(quiet)
    rng.shuffle(never)
    recent.sort(key=lambda a: (a.last_played, a.albumhash))

    return [*quiet, *never, *(a.albumhash for a in recent)]


def advent_picks(
    albums: Sequence[AdventAlbum],
    userid: int,
    year: int,
    day: int,
    now: float,
    made: Mapping[int, str] | None = None,
    skip: Callable[[str], bool] = lambda artisthash: False,
) -> dict[int, str]:
    """
    The album behind each door `1..day`, as `{door: albumhash}`.

    Doors in `made` keep their album. Each other door takes the first album of
    the order that no door of this year has yet, and once the library runs out
    the order repeats from its start. An empty library gives no doors.
    """
    picks: dict[int, str] = {}
    order = advent_order(albums, userid, year, now, skip)
    if not order:
        return picks

    decided = dict(made or {})
    used = set(decided.values())

    for door in range(1, day + 1):
        if door in decided:
            picks[door] = decided[door]
            continue

        album = next((albumhash for albumhash in order if albumhash not in used), None)
        if album is None:
            album = order[(door - 1) % len(order)]

        decided[door] = album
        used.add(album)
        picks[door] = album

    return picks
