"""The listening clock (#535): plays per weekday and hour, Monday first."""

from aivinnet.lib.listening_clock import build_clock, clock_grid


def test_sqlites_sunday_zero_becomes_the_last_row():
    grid = clock_grid([("1", "09", 100), ("0", "23", 50), ("6", "00", 30)])

    assert grid[0][9] == 100  # Monday
    assert grid[6][23] == 50  # Sunday
    assert grid[5][0] == 30  # Saturday


def test_rows_sqlite_could_not_place_are_skipped():
    grid = clock_grid([(None, None, 100), ("2", "xx", 10), ("2", "24", 10), ("2", "07", None)])

    assert sum(map(sum, grid)) == 0


def test_the_busiest_hour_and_day():
    body = build_clock([("5", "20", 300), ("5", "21", 200), ("1", "08", 400)])

    assert body["total"] == 900
    # One Monday hour beats every Friday hour, Friday the day.
    assert body["peak_hour"] == {"day": 0, "hour": 8, "seconds": 400}
    assert body["peak_day"] == {"day": 4, "seconds": 500}


def test_a_tie_goes_to_the_earlier_hour():
    body = build_clock([("3", "10", 100), ("2", "22", 100), ("2", "07", 100)])

    assert body["peak_hour"] == {"day": 1, "hour": 7, "seconds": 100}
    assert body["peak_day"] == {"day": 1, "seconds": 200}


def test_a_period_without_music():
    body = build_clock([])

    assert body == {"days": [[0] * 24 for _ in range(7)], "total": 0, "peak_hour": None, "peak_day": None}
