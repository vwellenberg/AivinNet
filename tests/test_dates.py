"""Tests for aivinnet.utils.dates."""

from unittest import mock

import pendulum
import pytest

from aivinnet.utils.dates import get_date_range, get_previous_period_start, seconds_to_time_string


class TestSecondsToTimeString:
    def test_zero_seconds(self):
        assert seconds_to_time_string(0) == "0 sec"

    def test_seconds_only(self):
        assert seconds_to_time_string(45) == "45 sec"

    def test_one_minute(self):
        assert seconds_to_time_string(60) == "1 min"

    def test_minutes_plural(self):
        assert seconds_to_time_string(120) == "2 mins"

    def test_one_hour(self):
        assert seconds_to_time_string(3600) == "1 hr"

    def test_hours_plural(self):
        assert seconds_to_time_string(7200) == "2 hrs"

    def test_hours_and_minutes(self):
        assert seconds_to_time_string(3660) == "1 hr, 1 min"

    def test_hours_and_minutes_plural(self):
        assert seconds_to_time_string(7320) == "2 hrs, 2 mins"

    def test_large_value(self):
        result = seconds_to_time_string(86400)  # 24 hours
        assert result == "24 hrs"


class TestGetPreviousPeriodStart:
    """
    The charts' trend arrows compare the current period with the one before it.
    This used to be `start - get_duration_in_seconds(d)`, which returned the
    period's start TIMESTAMP, not a length: the "previous period" began at 1970
    and every chart compared itself against the whole history.
    """

    @staticmethod
    def _ts(*args) -> int:
        return int(pendulum.datetime(*args, tz="local").timestamp())

    def test_day_is_yesterday(self):
        today = self._ts(2026, 10, 8)
        assert get_previous_period_start("day", today) == self._ts(2026, 10, 7)

    def test_day_across_a_month_boundary(self):
        assert get_previous_period_start("day", self._ts(2026, 3, 1)) == self._ts(2026, 2, 28)

    def test_week_is_last_week(self):
        monday = self._ts(2026, 10, 5)
        assert get_previous_period_start("week", monday) == self._ts(2026, 9, 28)

    def test_month_is_last_month(self):
        assert get_previous_period_start("month", self._ts(2026, 3, 1)) == self._ts(2026, 2, 1)

    def test_year_is_last_year(self):
        assert get_previous_period_start("year", self._ts(2026, 1, 1)) == self._ts(2025, 1, 1)

    def test_previous_period_is_never_the_whole_history(self):
        today = self._ts(2026, 10, 8)
        for duration in ("day", "week", "month", "year"):
            assert get_previous_period_start(duration, today) > self._ts(2024, 1, 1)

    def test_alltime_has_an_empty_previous_period(self):
        assert get_previous_period_start("alltime", 0) == 0

    def test_unknown_duration_raises(self):
        with pytest.raises(ValueError):
            get_previous_period_start("hour", self._ts(2026, 10, 8))


class TestLastWeekAndLastMonth:
    """
    "lastweek" and "lastmonth" are the previous calendar week and month: the
    recap card on Home opens them on Mondays and the 1st, when the current
    period has no plays yet. The range ends where the current period begins,
    not at now.
    """

    @staticmethod
    def _ts(*args) -> int:
        return int(pendulum.datetime(*args, tz="local").timestamp())

    @staticmethod
    def _at(*args):
        return pendulum.datetime(*args, tz="local")

    @staticmethod
    def _range_at(now, duration: str) -> tuple[int, int]:
        # Freeze the clock the way the module reads it: `pendulum.now()`.
        with mock.patch("pendulum.now", return_value=now):
            return get_date_range(duration)

    def test_lastweek_on_a_wednesday_is_the_week_before_this_monday(self):
        now = self._at(2026, 10, 7, 10, 0)

        assert self._range_at(now, "lastweek") == (self._ts(2026, 9, 28), self._ts(2026, 10, 5))

    def test_lastweek_on_a_monday_is_the_whole_week_before(self):
        # The recap's own day: "this week" has no plays yet, last week is full.
        now = self._at(2026, 10, 5, 8, 0)

        assert self._range_at(now, "lastweek") == (self._ts(2026, 9, 28), self._ts(2026, 10, 5))

    def test_lastweek_just_after_midnight_on_a_monday(self):
        now = self._at(2026, 10, 5, 0, 0, 1)

        assert self._range_at(now, "lastweek") == (self._ts(2026, 9, 28), self._ts(2026, 10, 5))

    def test_lastmonth_on_the_first_is_the_whole_month_before(self):
        # The 1st: "this month" is empty, last month is the card's period.
        now = self._at(2026, 11, 1, 9, 0)

        assert self._range_at(now, "lastmonth") == (self._ts(2026, 10, 1), self._ts(2026, 11, 1))

    def test_lastmonth_mid_month(self):
        now = self._at(2026, 10, 15, 12, 0)

        assert self._range_at(now, "lastmonth") == (self._ts(2026, 9, 1), self._ts(2026, 10, 1))

    def test_lastmonth_across_the_year_boundary(self):
        now = self._at(2026, 1, 10, 12, 0)

        assert self._range_at(now, "lastmonth") == (self._ts(2025, 12, 1), self._ts(2026, 1, 1))

    def test_the_range_ends_at_the_current_period_not_at_now(self):
        now = self._at(2026, 10, 7, 10, 0)

        for duration in ("lastweek", "lastmonth"):
            _, end = self._range_at(now, duration)
            assert end < int(now.timestamp()), duration

    def test_previous_period_of_lastweek_is_the_week_before_it(self):
        now = self._at(2026, 10, 7, 10, 0)
        start, _ = self._range_at(now, "lastweek")

        assert get_previous_period_start("lastweek", start) == self._ts(2026, 9, 21)

    def test_previous_period_of_lastmonth_is_the_month_before_it(self):
        now = self._at(2026, 11, 1, 9, 0)
        start, _ = self._range_at(now, "lastmonth")

        assert get_previous_period_start("lastmonth", start) == self._ts(2026, 9, 1)

    def test_previous_period_of_lastmonth_across_the_year_boundary(self):
        assert get_previous_period_start("lastmonth", self._ts(2026, 1, 1)) == self._ts(2025, 12, 1)

    def test_previous_period_of_a_monday_start_is_the_week_before_it(self):
        # The period starting Monday 2026-10-05; the week before starts 2026-09-28.
        assert get_previous_period_start("lastweek", self._ts(2026, 10, 5)) == self._ts(2026, 9, 28)

    def test_previous_period_of_lastweek_across_a_month_boundary(self):
        # Monday 2026-09-07 starts the period; the week before starts 2026-08-31,
        # in the month before September.
        assert get_previous_period_start("lastweek", self._ts(2026, 9, 7)) == self._ts(2026, 8, 31)

    def test_the_new_periods_are_valid_durations(self):
        now = self._at(2026, 10, 7, 10, 0)

        for duration in ("lastweek", "lastmonth"):
            assert len(self._range_at(now, duration)) == 2
            assert get_previous_period_start(duration, self._ts(2026, 10, 1)) < self._ts(2026, 10, 1)
