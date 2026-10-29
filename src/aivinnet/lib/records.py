"""
Pure rules behind the records board on the stats page (#540) and the milestone
plays (#545).

Like `lib/home/discover.py`, deliberately free of database and store imports:
the cron in `lib/recipes/records.py` reads the plays and hands them over, so the
rules are testable in the fast lane (see `.claude/rules/tests.md`).

Every play counts, including one whose track has since left the library. The
milestone count is the number of rows the user has, and a record that vanished
with its track would shrink the board on every retag.
"""

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import NamedTuple

from aivinnet.lib.home.discover import SESSION_GAP

# An obsession is a track played again and again: one play in a day is not.
OBSESSION_MIN_PLAYS = 2

# The plays the easter egg celebrates (#545): the round ones, and 1,337.
CELEBRATED_PLAYS = frozenset({1_000, 1_337, 10_000, 100_000})


class PlayRow(NamedTuple):
    """One play as the records board reads it: `ScrobbleTable.records_rows`."""

    timestamp: int
    duration: int
    trackhash: str
    # The calendar day in the server's local zone, ISO ("2026-03-04").
    day: str


@dataclass(frozen=True)
class Session:
    start: int
    # The last play's start plus its length: the session ends when the music does.
    end: int
    plays: int


@dataclass(frozen=True)
class Obsession:
    trackhash: str
    day: str
    plays: int


@dataclass(frozen=True)
class Milestone:
    number: int
    trackhash: str
    timestamp: int


@dataclass(frozen=True)
class Board:
    plays: int
    longest_session: Session | None
    obsession: Obsession | None
    milestones: list[Milestone]


def board_milestones(total: int) -> list[int]:
    """
    The play numbers the board has a row for, up to `total` plays: the very
    first play, then 1,000, 10,000, 100,000 …
    """
    if total < 1:
        return []

    numbers = [1]
    number = 1_000
    while number <= total:
        numbers.append(number)
        number *= 10
    return numbers


def celebrated(count: int) -> bool:
    """
    Whether the user's `count`-th play is one the easter egg celebrates. Every
    count is reached once per user, so each milestone fires once.
    """
    return count in CELEBRATED_PLAYS


def _longer(best: Session | None, session: Session) -> Session:
    # Sessions come oldest first: on a tie the earlier one keeps the record.
    if best is None or session.end - session.start > best.end - best.start:
        return session
    return best


def longest_session(plays: Iterable[PlayRow]) -> Session | None:
    """
    The longest listening session. A session is cut where a play starts more
    than `SESSION_GAP` after the previous one started — the same boundary as
    "Because you listened" (`lib/home/discover._sessions`).
    """
    best: Session | None = None
    start = end = last_start = 0
    count = 0

    for play in sorted(plays, key=lambda p: p.timestamp):
        if count and play.timestamp - last_start > SESSION_GAP:
            best = _longer(best, Session(start, end, count))
            count = 0
        if count == 0:
            start, end = play.timestamp, 0
        count += 1
        last_start = play.timestamp
        end = max(end, play.timestamp + play.duration)

    if count:
        best = _longer(best, Session(start, end, count))
    return best


def obsession(plays: Iterable[PlayRow]) -> Obsession | None:
    """
    The track played most on one day. A tie goes to the earlier day, then to
    the hash, so the same history always names the same record.
    """
    counts = Counter((play.trackhash, play.day) for play in plays)
    if not counts:
        return None

    (trackhash, day), played = min(counts.items(), key=lambda item: (-item[1], item[0][1], item[0][0]))
    if played < OBSESSION_MIN_PLAYS:
        return None
    return Obsession(trackhash, day, played)


def milestones(plays: list[PlayRow]) -> list[Milestone]:
    """The play at each board milestone. `plays` is the whole history, oldest first."""
    ordered = sorted(plays, key=lambda p: p.timestamp)
    return [
        Milestone(number, ordered[number - 1].trackhash, ordered[number - 1].timestamp)
        for number in board_milestones(len(ordered))
    ]


def build_board(plays: list[PlayRow]) -> Board:
    """Everything the records board shows, for one user's whole history."""
    return Board(
        plays=len(plays),
        longest_session=longest_session(plays),
        obsession=obsession(plays),
        milestones=milestones(plays),
    )
