"""
The server's calling card behind the search "aivin" (#547), over the real request
cycle: the endpoint's numbers, the plays of all users counted from the real
table, the hourly fill, and a logged play that moves the card in RAM.
"""

import pytest
from test_home_discover_api import FNM, PRIMUS, home, th  # noqa: F401 - the imported fixture

from aivinnet.lib.server_card import SERVER_TOTALS

CARD_KEYS = {"version", "uptime", "tracks", "albums", "artists", "plays", "since"}


@pytest.fixture()
def totals(monkeypatch):
    """The shared RAM totals, put back as they were after the test."""
    monkeypatch.setattr(SERVER_TOTALS, "_plays", None)
    monkeypatch.setattr(SERVER_TOTALS, "_oldest", None)
    return SERVER_TOTALS


def scrobble_row(userid: int, timestamp: int):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add({"trackhash": "t", "timestamp": timestamp, "duration": 200, "source": "", "userid": userid})


def test_the_card_counts_the_library_and_the_totals(api_client, monkeypatch, totals):
    import aivinnet.api.search as search_api

    monkeypatch.setattr(search_api.TrackStore, "trackhashmap", {"a": object(), "b": object()})
    monkeypatch.setattr(search_api.AlbumStore, "albummap", {"x": object()})
    monkeypatch.setattr(search_api.ArtistStore, "artistmap", {"p": object(), "q": object(), "r": object()})
    totals.fill(42, 1_600_000_000)

    res = api_client("aivinnet.api.search").get("/search/server-card")

    assert res.status_code == 200
    card = res.get_json()
    assert set(card) == CARD_KEYS
    assert (card["tracks"], card["albums"], card["artists"]) == (2, 1, 3)
    assert (card["plays"], card["since"]) == (42, 1_600_000_000)
    assert card["version"] == search_api.SERVER_VERSION
    assert card["uptime"] >= 0


def test_the_card_holds_numbers_only_and_no_names(api_client, monkeypatch, totals):
    totals.fill(3, 1_600_000_000)

    card = api_client("aivinnet.api.search").get("/search/server-card").get_json()

    for key, value in card.items():
        if key == "version":
            assert isinstance(value, str)
        else:
            assert value is None or isinstance(value, int), key


def test_before_the_first_fill_the_card_says_unknown_not_zero(api_client, totals):
    card = api_client("aivinnet.api.search").get("/search/server-card").get_json()

    assert card["plays"] is None
    assert card["since"] is None


def test_the_plays_of_every_user_are_counted_from_the_table(api_client):
    from aivinnet.db.userdata import ScrobbleTable

    api_client("aivinnet.api.search")  # the tables and the two users
    scrobble_row(userid=1, timestamp=1_650_000_000)
    scrobble_row(userid=1, timestamp=1_700_000_000)
    scrobble_row(userid=2, timestamp=1_600_000_000)

    assert ScrobbleTable.totals() == (3, 1_600_000_000)


def test_no_plays_gives_no_oldest_play(api_client):
    from aivinnet.db.userdata import ScrobbleTable

    api_client("aivinnet.api.search")

    assert ScrobbleTable.totals() == (0, None)


def test_the_hourly_fill_takes_the_database_figures(api_client, totals):
    from aivinnet.crons import _refresh_server_totals

    api_client("aivinnet.api.search")
    scrobble_row(userid=1, timestamp=1_650_000_000)
    scrobble_row(userid=2, timestamp=1_600_000_000)

    _refresh_server_totals()

    assert totals.snapshot() == (2, 1_600_000_000)


def test_a_logged_play_moves_the_card_without_a_read(api_client, home, monkeypatch, totals):  # noqa: F811
    import aivinnet.api.scrobble as scrobble_api

    class NoLastFm:
        enabled = False

        def __init__(self, current_userid: int):
            pass

    monkeypatch.setattr(scrobble_api, "LastFmPlugin", NoLastFm)
    totals.fill(5, 1_600_000_000)
    logger = api_client("aivinnet.api.scrobble")

    body = {"trackhash": th(PRIMUS, 1), "duration": 200, "source": f"al:{PRIMUS}", "timestamp": 1_700_000_000}
    assert logger.post("/logger/track/log", json=body).status_code == 201

    assert totals.snapshot() == (6, 1_600_000_000)

    # An older play, from a backup or a clock that was wrong: the oldest moves.
    body = {"trackhash": th(FNM, 1), "duration": 200, "source": f"al:{FNM}", "timestamp": 1_500_000_000}
    assert logger.post("/logger/track/log", json=body).status_code == 201

    assert totals.snapshot() == (7, 1_500_000_000)
