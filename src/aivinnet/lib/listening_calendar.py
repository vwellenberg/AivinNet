"""
The listening calendar on the stats page (#525): a year of days, each with the
time listened, and the streaks of days in a row with music.

Pure rules, free of database and store imports like `lib/home/discover.py`:
`ScrobbleTable.seconds_per_day` sums the plays per calendar day in SQL, and
these functions turn that into the calendar. Testable in the fast lane.

Days are the server's calendar days. Totals AND today come from SQLite's
`localtime` (the C library's zone, see `ScrobbleTable.seconds_per_day`), so the
two cannot disagree about which day a play belongs to.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

# Below this a day is no listening day: a play is logged from five seconds on,
# and one track skipped at breakfast should neither keep a streak alive nor
# colour a square.
MIN_DAY_SECONDS = 60

# A year of whole weeks, today in the last one — the shape of a contribution
# calendar: 53 columns, Monday on top.
CALENDAR_WEEKS = 53


@dataclass(frozen=True)
class Streak:
    days: int
    start: date | None = None
    end: date | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "days": self.days,
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
        }


def listening_days(
    totals: Iterable[tuple[str | None, int | None]], min_seconds: int = MIN_DAY_SECONDS
) -> dict[date, int]:
    """
    `{day: seconds}` for every day with at least `min_seconds` listened.

    `totals` is `(ISO date, seconds)` as SQLite's `date()` gives it; a row
    without a date (a timestamp SQLite cannot place) is skipped.
    """
    days: dict[date, int] = {}
    for day, seconds in totals:
        if not day or not seconds or seconds < min_seconds:
            continue
        try:
            days[date.fromisoformat(day)] = int(seconds)
        except ValueError:
            continue

    return days


def current_streak(days: Iterable[date], today: date) -> Streak:
    """
    The days in a row up to today — or up to yesterday while today has no
    music yet: a streak should not read as broken every morning.
    """
    have = set(days)
    end = today if today in have else today - timedelta(days=1)
    if end not in have:
        return Streak(0)

    start = end
    while start - timedelta(days=1) in have:
        start -= timedelta(days=1)

    return Streak((end - start).days + 1, start, end)


def longest_streak(days: Iterable[date]) -> Streak:
    """The longest run of days in a row; the latest one wins a tie."""
    best = Streak(0)
    run_start: date | None = None
    previous: date | None = None

    for day in sorted(set(days)):
        if run_start is None or previous is None or day - previous != timedelta(days=1):
            run_start = day
        previous = day

        length = (day - run_start).days + 1
        if length >= best.days:
            best = Streak(length, run_start, day)

    return best


def calendar_start(today: date, weeks: int = CALENDAR_WEEKS) -> date:
    """The Monday that opens the calendar: `weeks` columns, today in the last."""
    this_monday = today - timedelta(days=today.weekday())
    return this_monday - timedelta(weeks=weeks - 1)


def build_calendar(totals: Iterable[tuple[str | None, int | None]], today: date) -> dict[str, Any]:
    """
    The `GET /logger/calendar` payload: the window, the listened seconds of
    each day in it (days without music are left out), and both streaks over
    the whole history.

    Days after `today` count nowhere: a play stamped by a device whose clock
    runs ahead would otherwise end the longest streak on a date the calendar
    never shows.
    """
    days = {day: seconds for day, seconds in listening_days(totals).items() if day <= today}
    start = calendar_start(today)

    return {
        "start": start.isoformat(),
        "end": today.isoformat(),
        "days": {day.isoformat(): seconds for day, seconds in sorted(days.items()) if start <= day <= today},
        "streaks": {
            "current": current_streak(days, today).as_dict(),
            "longest": longest_streak(days).as_dict(),
        },
    }
