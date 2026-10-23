"""
"Almost complete" on Home (#529): albums heard to at least 60 %, the songs
still missing as "Play the rest". Real request cycle, real scrobbles, the real
routine, on the library of `test_home_discover_api` (5 tracks per album).
"""

import pendulum
import pytest
from test_home_discover_api import FNM, MILES, PRIMUS, UNTAGGED, home, rows, scrobble, th  # noqa: F401

DAY = 86400


@pytest.fixture()
def almost(home, monkeypatch):  # noqa: F811 - the imported fixture
    import aivinnet.lib.home.onrepeat as onrepeat

    monkeypatch.setattr(onrepeat, "get_current_userid", lambda: home.userid)
    return home


def run():
    from aivinnet.lib.recipes.homerows import AlmostComplete

    AlmostComplete()


def listened(albumhash: str, *numbers: int, userid: int = 1, days_ago: int = 400):
    # Long ago on purpose: the whole history counts, not the last sessions.
    at = int(pendulum.now().timestamp()) - days_ago * DAY
    for i, n in enumerate(numbers):
        scrobble(th(albumhash, n), at + i * 200, userid)


def test_an_album_heard_to_sixty_percent_with_the_rest_to_play(almost):
    listened(PRIMUS, 1, 2, 4)  # 3 of 5
    listened(MILES, 1, 2)  # 2 of 5: not enough
    listened(FNM, 1, 2, 3, 4, 5)  # heard through

    run()
    data, _ = rows(almost)

    row = data["almost_complete"]
    assert row["title"] == "Almost complete"
    assert row["playlist"] == "almostcomplete"
    (card,) = row["items"]
    assert card["item"]["albumhash"] == PRIMUS
    assert card["item"]["help_text"] == "2 songs to go"
    assert card["item"]["home"] == {"missing": 2}
    assert card["item"]["image"] == f"{PRIMUS}.webp?pathhash=ph-Frizzle Fry"

    # "Play the rest": exactly the songs never played, in album order.
    res = almost.get("/playlists/almostcomplete")
    assert res.status_code == 200, res.text
    assert [t["trackhash"] for t in res.get_json()["tracks"]] == [th(PRIMUS, 3), th(PRIMUS, 5)]
    assert res.get_json()["info"]["name"] == "Almost complete"


def test_untagged_files_are_no_album_to_complete(almost):
    listened(UNTAGGED, 1, 2, 3, 4)

    run()

    assert rows(almost)[0].get("almost_complete", {"items": []})["items"] == []


def test_each_user_on_their_own(almost):
    listened(PRIMUS, 1, 2, 3, 4, userid=2)

    run()

    assert rows(almost)[0].get("almost_complete", {"items": []})["items"] == []
    almost.userid = 2
    (card,) = rows(almost)[0]["almost_complete"]["items"]
    assert card["item"]["help_text"] == "1 song to go"
    assert [t["trackhash"] for t in almost.get("/playlists/almostcomplete").get_json()["tracks"]] == [th(PRIMUS, 5)]


def test_playing_the_rest_makes_no_recently_played_card():
    from aivinnet.lib.home.homerows import CUSTOM_PLAYLISTS, DATED_PLAYLISTS

    # The songs still missing change by playing them: a card for the playlist
    # would play something else the next time.
    assert "almostcomplete" in CUSTOM_PLAYLISTS
    assert "almostcomplete" in DATED_PLAYLISTS


def test_playing_a_missing_song_shows_at_once(almost, api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api

    class NoLastFm:
        enabled = False

        def __init__(self, current_userid: int):
            pass

    monkeypatch.setattr(scrobble_api, "LastFmPlugin", NoLastFm)
    logger = api_client("aivinnet.api.scrobble")
    listened(PRIMUS, 1, 2, 4)  # 3 and 5 missing
    run()

    def log(n: int):
        body = {"trackhash": th(PRIMUS, n), "duration": 200, "source": f"al:{PRIMUS}", "timestamp": 1_700_000_000}
        assert logger.post("/logger/track/log", json=body).status_code == 201

    def card():
        items = rows(almost)[0].get("almost_complete", {"items": []})["items"]
        return items[0]["item"]["help_text"] if items else None

    def rest():
        return [t["trackhash"] for t in almost.get("/playlists/almostcomplete").get_json()["tracks"]]

    # A song that was not missing changes nothing.
    log(1)
    assert card() == "2 songs to go" and rest() == [th(PRIMUS, 3), th(PRIMUS, 5)]

    log(3)
    assert card() == "1 song to go" and rest() == [th(PRIMUS, 5)]

    # Heard through: the card goes, and so does the rest.
    log(5)
    assert card() is None and rest() == []
