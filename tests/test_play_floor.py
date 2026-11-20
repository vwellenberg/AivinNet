"""How long a track has to play to count (#882): 5 s, less for a shorter track.

The table is the client's too (`client/src/stores/__tests__/tracker.test.ts`):
if they disagreed, the client would send plays the server 400s, or hold back
plays the server would take.
"""

import pytest

from aivinnet.lib.play_floor import can_be_logged, min_logged_seconds


@pytest.mark.parametrize(
    ("length", "floor"),
    [(0, 1), (3, 1), (4, 2), (6, 4), (7, 5), (300, 5)],
)
def test_the_floor_follows_a_short_track(length, floor):
    assert min_logged_seconds(length) == floor


def test_a_long_track_keeps_the_plain_five_seconds():
    # A skip stays a skip: the floor exists to drop those.
    assert min_logged_seconds(7) == min_logged_seconds(3600) == 5


@pytest.mark.parametrize(("length", "loggable"), [(0, False), (1, False), (2, False), (3, True), (200, True)])
def test_only_a_track_a_full_play_can_log_is_required(length, loggable):
    assert can_be_logged(length) is loggable
