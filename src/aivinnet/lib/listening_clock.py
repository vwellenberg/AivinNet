"""
The listening clock on the stats page (#535): when in the week the music
plays, as seconds listened per weekday and hour over the chosen period.

Pure rules, free of database and store imports like `lib/listening_calendar.py`:
`ScrobbleTable.seconds_by_weekday_hour` sums the plays per weekday and hour in
SQL, and this turns that into the 7-by-24 grid. Testable in the fast lane.

Hours are the server's, in SQLite's `localtime` like the listening calendar
next to it, and a play at 1 am on Saturday is Saturday's: the calendar day,
not the night before (as "Your weekday evenings" counts it).
"""

from collections.abc import Iterable
from typing import Any

DAYS = 7
HOURS = 24


def clock_grid(rows: Iterable[tuple[str | None, str | None, int | None]]) -> list[list[int]]:
    """
    Seven rows of 24 hours, Monday first.

    `rows` are `(weekday, hour, seconds)` as SQLite's `strftime('%w')` and
    `strftime('%H')` give them: Sunday is "0", hours "00" to "23". A row
    SQLite could not place (no date) is skipped.
    """
    grid = [[0] * HOURS for _ in range(DAYS)]

    for weekday, hour, seconds in rows:
        if weekday is None or hour is None or not seconds:
            continue
        try:
            day, at = (int(weekday) - 1) % DAYS, int(hour)
        except ValueError:
            continue
        if 0 <= at < HOURS:
            grid[day][at] += int(seconds)

    return grid


def build_clock(rows: Iterable[tuple[str | None, str | None, int | None]]) -> dict[str, Any]:
    """
    The `GET /logger/clock` payload: the grid, the total, and the busiest hour
    and weekday (`null` for a period without music). A tie goes to the earlier
    one, so the answer does not change between two equal reads.
    """
    grid = clock_grid(rows)
    total = sum(map(sum, grid))

    peak_hour = None
    peak_day = None
    if total:
        # `max` keeps the first of equals: the earlier hour, the earlier day.
        day, hour = max(((d, h) for d in range(DAYS) for h in range(HOURS)), key=lambda at: grid[at[0]][at[1]])
        peak_hour = {"day": day, "hour": hour, "seconds": grid[day][hour]}
        busiest = max(range(DAYS), key=lambda d: sum(grid[d]))
        peak_day = {"day": busiest, "seconds": sum(grid[busiest])}

    return {"days": grid, "total": total, "peak_hour": peak_hour, "peak_day": peak_day}
