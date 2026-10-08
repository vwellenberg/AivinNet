"""A timestamp that is no date must not take a whole page down (#391).

`timestamp_to_time_passed` feeds Home ("Recently played"), the favourites page
and the library lists. A scrobble written in milliseconds sorted first forever
and `datetime.fromtimestamp` raised on it, so `GET /nothome/` answered 500 for
that user on every load. New entries are refused at `POST /logger/track/log`;
this covers the rows that are already in a database.
"""

import time

import pytest

from aivinnet.utils.dates import timestamp_to_time_passed


@pytest.mark.parametrize(
    "timestamp",
    [
        1_790_000_000_000,  # milliseconds
        253_402_300_800,  # year 10000
        10**30,
    ],
)
def test_no_date_is_an_empty_label(timestamp):
    assert timestamp_to_time_passed(timestamp) == ""


def test_a_real_moment_still_reads_as_time_passed():
    assert timestamp_to_time_passed(time.time() - 3 * 3600) == "3 hours ago"
