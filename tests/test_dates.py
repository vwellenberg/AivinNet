"""Tests for aivinnet.utils.dates."""

import pendulum
import pytest

from aivinnet.utils.dates import get_previous_period_start, seconds_to_time_string


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
