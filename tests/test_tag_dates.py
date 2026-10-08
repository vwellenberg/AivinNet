"""A release date from a tag is a calendar date, not a moment (#391).

`parse_date("2019")` stores 2019-01-01T00:00 UTC. Read back in local time, any
host or browser west of UTC showed 2018: every year-only album one year early,
and an artist's decade chip a decade early for "2020". The stored value is
right; the readers take the year in UTC now.

And `pendulum.parse(strict=False)` read anything: "1" became the 1st of the
CURRENT month, "May 2019" today's day in May 2019. Such an album wandered with
every scan. Only a year in front, or a year standing alone, counts now.
"""

import os
import sys
import time
from datetime import UTC, datetime
from unittest.mock import MagicMock

for mod_name in ["PIL", "tinytag"]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import pytest  # noqa: E402

from aivinnet.lib.taglib import parse_date  # noqa: E402
from aivinnet.utils.dates import tag_year  # noqa: E402


def _utc(*args):
    return int(datetime(*args, tzinfo=UTC).timestamp())


@pytest.mark.parametrize(
    ("tag", "expected"),
    [
        ("2019", _utc(2019, 1, 1)),
        ("2019-05-03", _utc(2019, 5, 3)),
        ("2019-05", _utc(2019, 5, 1)),
        ("2019/05/03", _utc(2019, 5, 3)),
        ("2019-05-03T10:00:00Z", _utc(2019, 5, 3)),
        ("20190503", _utc(2019, 5, 3)),
        ("1965", _utc(1965, 1, 1)),
        (" 1987 ", _utc(1987, 1, 1)),
        ("2019-13-40", _utc(2019, 1, 1)),  # a broken month keeps the year
        ("03.05.2019", _utc(2019, 1, 1)),  # day-first: the year is what is sure
        ("May 2019", _utc(2019, 1, 1)),
    ],
)
def test_a_tag_with_a_year_is_read(tag, expected):
    assert parse_date(tag) == expected


@pytest.mark.parametrize("tag", ["", "1", "12", "-1", "unknown", "0000", "0099", "123"])
def test_a_tag_without_a_year_is_no_date(tag):
    """The caller then takes the file's mtime, as for an empty tag."""
    assert parse_date(tag) is None


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="time.tzset is POSIX-only")
def test_the_year_of_a_tag_date_is_read_in_utc():
    original = os.environ.get("TZ")
    os.environ["TZ"] = "America/New_York"
    time.tzset()
    try:
        assert datetime.fromtimestamp(_utc(2020, 1, 1)).year == 2019  # the bug, on this host
        assert tag_year(_utc(2020, 1, 1)) == 2020
    finally:
        if original is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = original
        time.tzset()


def test_a_year_before_1970_is_read_too():
    """`fromtimestamp` refuses negative timestamps on Windows."""
    assert tag_year(_utc(1965, 1, 1)) == 1965


@pytest.mark.parametrize("timestamp", [0, None, 10**30])
def test_no_date_is_no_year(timestamp):
    assert tag_year(timestamp) is None
