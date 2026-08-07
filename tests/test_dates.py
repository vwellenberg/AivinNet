"""Tests for aivinnet.utils.dates."""

from aivinnet.utils.dates import seconds_to_time_string


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
