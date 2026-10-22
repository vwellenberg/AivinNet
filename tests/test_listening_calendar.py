"""
The listening calendar on the stats page (`lib/listening_calendar.py`, #525):
which days count, both streaks, and the window of a year of whole weeks.

The module imports no database or store code, so these run in the fast lane.
"""

from datetime import date, timedelta

from aivinnet.lib.listening_calendar import (
    CALENDAR_WEEKS,
    MIN_DAY_SECONDS,
    Streak,
    build_calendar,
    calendar_start,
    current_streak,
    listening_days,
    longest_streak,
)

TODAY = date(2026, 10, 22)  # a Thursday


def days_back(*offsets: int) -> set[date]:
    return {TODAY - timedelta(days=n) for n in offsets}


class TestListeningDays:
    def test_a_day_needs_a_minute(self):
        totals = [("2026-10-20", MIN_DAY_SECONDS), ("2026-10-21", MIN_DAY_SECONDS - 1)]

        assert listening_days(totals) == {date(2026, 10, 20): 60}

    def test_rows_sqlite_cannot_place_are_skipped(self):
        # date() of a timestamp out of range is NULL; a NULL sum is a day without plays.
        totals = [(None, 600), ("2026-10-20", None), ("not a date", 600), ("2026-10-21", 600)]

        assert listening_days(totals) == {date(2026, 10, 21): 600}


class TestCurrentStreak:
    def test_days_in_a_row_up_to_today(self):
        assert current_streak(days_back(0, 1, 2, 4), TODAY) == Streak(3, TODAY - timedelta(days=2), TODAY)

    def test_today_without_music_yet_does_not_break_it(self):
        # In the morning the streak still counts up to yesterday.
        assert current_streak(days_back(1, 2), TODAY) == Streak(2, TODAY - timedelta(days=2), TODAY - timedelta(days=1))

    def test_a_gap_before_yesterday_is_no_streak(self):
        assert current_streak(days_back(2, 3), TODAY) == Streak(0)

    def test_no_history(self):
        assert current_streak(set(), TODAY) == Streak(0)

    def test_across_the_new_year(self):
        new_year = date(2026, 1, 2)
        days = {date(2025, 12, 30), date(2025, 12, 31), date(2026, 1, 1), new_year}

        assert current_streak(days, new_year).days == 4


class TestLongestStreak:
    def test_the_longest_run(self):
        days = days_back(0, 1, 10, 11, 12, 13, 20)

        assert longest_streak(days) == Streak(4, TODAY - timedelta(days=13), TODAY - timedelta(days=10))

    def test_a_tie_goes_to_the_latest(self):
        days = days_back(0, 1, 10, 11)

        assert longest_streak(days) == Streak(2, TODAY - timedelta(days=1), TODAY)

    def test_one_day_is_a_streak_of_one(self):
        assert longest_streak({TODAY}) == Streak(1, TODAY, TODAY)

    def test_no_history(self):
        assert longest_streak([]) == Streak(0)


class TestWindow:
    def test_whole_weeks_monday_first_today_in_the_last(self):
        start = calendar_start(TODAY)

        assert start.weekday() == 0
        assert (TODAY - start).days // 7 == CALENDAR_WEEKS - 1
        # Monday of this week, 52 weeks back.
        assert start == date(2025, 10, 20)

    def test_a_monday_opens_its_own_week(self):
        monday = date(2026, 10, 19)

        assert calendar_start(monday) == monday - timedelta(weeks=CALENDAR_WEEKS - 1)


class TestBuildCalendar:
    def test_the_payload(self):
        totals = [
            ("2026-10-22", 3600),
            ("2026-10-21", 600),
            ("2026-10-20", 30),  # under a minute: no listening day
            ("2025-10-19", 900),  # the day before the window
            ("2024-01-01", 120),
        ]

        calendar = build_calendar(totals, TODAY)

        assert calendar["start"] == "2025-10-20"
        assert calendar["end"] == "2026-10-22"
        assert calendar["days"] == {"2026-10-21": 600, "2026-10-22": 3600}
        assert calendar["streaks"] == {
            "current": {"days": 2, "start": "2026-10-21", "end": "2026-10-22"},
            # The whole history counts, not only the window: a tie, the latest wins.
            "longest": {"days": 2, "start": "2026-10-21", "end": "2026-10-22"},
        }

    def test_a_day_after_today_counts_nowhere(self):
        # A device clock running ahead: the streak must end where the grid does.
        calendar = build_calendar([("2026-10-22", 600), ("2026-10-23", 600)], TODAY)

        assert calendar["days"] == {"2026-10-22": 600}
        assert calendar["streaks"]["longest"]["end"] == "2026-10-22"

    def test_an_empty_history(self):
        calendar = build_calendar([], TODAY)

        assert calendar["days"] == {}
        assert calendar["streaks"]["current"] == {"days": 0, "start": None, "end": None}
        assert calendar["streaks"]["longest"] == {"days": 0, "start": None, "end": None}
