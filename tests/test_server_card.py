"""
The server's calling card behind the search "aivin" (#547): the RAM totals and
the card's numbers. Pure, so the fast lane runs it.
"""

import threading

from aivinnet.lib.server_card import ServerTotals, build_card


def test_nothing_is_known_before_the_first_fill():
    assert ServerTotals().snapshot() == (None, None)


def test_a_fill_replaces_both_figures():
    totals = ServerTotals()
    totals.fill(120, 1_600_000_000)
    totals.fill(7, None)

    assert totals.snapshot() == (7, None)


def test_a_logged_play_counts_on_top_of_the_fill():
    totals = ServerTotals()
    totals.fill(10, 1_600_000_000)

    totals.note_play(1_700_000_000)

    assert totals.snapshot() == (11, 1_600_000_000)


def test_a_play_before_the_first_fill_is_left_to_the_fill():
    # The fill reads the database, which holds this play: counting it here too
    # would count it twice.
    totals = ServerTotals()
    totals.note_play(1_700_000_000)

    assert totals.snapshot() == (None, None)


def test_the_oldest_play_moves_back_when_an_older_one_arrives():
    totals = ServerTotals()
    totals.fill(0, None)

    totals.note_play(1_700_000_000)
    assert totals.snapshot() == (1, 1_700_000_000)

    totals.note_play(1_650_000_000)
    assert totals.snapshot() == (2, 1_650_000_000)


def test_concurrent_plays_are_all_counted():
    totals = ServerTotals()
    totals.fill(0, None)

    def many():
        for i in range(1000):
            totals.note_play(1_700_000_000 + i)

    threads = [threading.Thread(target=many) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert totals.snapshot() == (4000, 1_700_000_000)


def test_the_card_carries_numbers_and_no_names():
    card = build_card(
        version="2026.10.1",
        started_at=1_000.0,
        now=1_000.0 + 3 * 86400 + 5 * 3600 + 42.9,
        tracks=5_000,
        albums=400,
        artists=120,
        plays=99_000,
        since=1_600_000_000,
    )

    assert card == {
        "version": "2026.10.1",
        "uptime": 3 * 86400 + 5 * 3600 + 42,
        "tracks": 5_000,
        "albums": 400,
        "artists": 120,
        "plays": 99_000,
        "since": 1_600_000_000,
    }


def test_a_clock_that_runs_backwards_does_not_give_a_negative_uptime():
    card = build_card(
        version="v",
        started_at=2_000.0,
        now=1_000.0,
        tracks=0,
        albums=0,
        artists=0,
        plays=None,
        since=None,
    )

    assert card["uptime"] == 0
    assert card["plays"] is None and card["since"] is None
