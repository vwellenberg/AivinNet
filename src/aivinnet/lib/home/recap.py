"""
The recap card on Home (#530): which period it tells about, and whether it is
still news for the user.

Mondays it recaps the week before, on the 1st the month before. A 1st that is
also a Monday recaps the month: the bigger recap, and one card, not two. The
date is the server's, in its own time zone, like "On this day" and the
weekday rows.

Pure rules, like the rest of `lib/home/`: the endpoint (`api/home`) reads the
period's plays and names; these functions decide the period, its key, and
whether the user still has it to see. Testable in the fast lane, strict under
mypy.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

RecapKind = Literal["week", "month"]

# What "dismissed" stores: the key of the period the user closed the card for.
# A key is "week:2026-10-19" (the first day of the week) or "month:2026-10".
RECAP_KEY_PATTERN = re.compile(r"^(week:\d{4}-\d{2}-\d{2}|month:\d{4}-\d{2})$")


@dataclass(frozen=True)
class RecapPeriod:
    kind: RecapKind
    # The first day, and the day after the last one: [first, until).
    first: date
    until: date
    key: str


def recap_period(today: date) -> RecapPeriod | None:
    """The period the recap card shows on `today`, or None on any other day."""
    if today.day == 1:
        first = (today - timedelta(days=1)).replace(day=1)
        return RecapPeriod("month", first, today, f"month:{first:%Y-%m}")

    if today.weekday() == 0:
        first = today - timedelta(days=7)
        return RecapPeriod("week", first, today, f"week:{first.isoformat()}")

    return None


def is_recap_key(key: str) -> bool:
    return RECAP_KEY_PATTERN.match(key) is not None


def is_news(period: RecapPeriod | None, dismissed: str | None) -> bool:
    """The card shows while its period is not the one the user closed it for."""
    return period is not None and period.key != dismissed


def has_plays(plays: int) -> bool:
    """An empty period gets no card: there is nothing to tell."""
    return plays > 0
