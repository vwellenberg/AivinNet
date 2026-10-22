"""`GET /logger/stats?period=…` — the tiles follow the charts' period (#523).

The five tiles under the charts were fixed to the week: the handler set
`period = "week"` and took no query, so picking "Year" above them changed the
charts and left "139 track plays this week" standing underneath.
"""

import time
from types import SimpleNamespace

import pytest

HASH = "0853280a12c4f9e1"
ALBUM = "a1b2c3d4e5f60718"
DAY = 24 * 60 * 60


def make_track():
    return SimpleNamespace(
        trackhash=HASH,
        title="Blue",
        artists=[{"name": "The Artist"}],
        # The real shape: the entity travels as a query on the image name.
        image=f"{ALBUM}.webp?pathhash=0a1b2c3d4e5f6071&fb=track",
        playduration=0,
        playcount=0,
    )


@pytest.fixture()
def stats_api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api
    import aivinnet.utils.stats as stats

    track = make_track()
    monkeypatch.setattr(
        stats.TrackStore,
        "get_tracks_by_trackhashes",
        staticmethod(lambda hashes: [track] if HASH in hashes else []),
        raising=False,
    )
    monkeypatch.setattr(scrobble_api.TrackStore, "get_flat_list", staticmethod(lambda: [track]), raising=False)
    return api_client("aivinnet.api.scrobble")


def scrobble(timestamp: int, duration: int, userid: int = 1, trackhash: str = HASH):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {
            "trackhash": trackhash,
            "timestamp": timestamp,
            "duration": duration,
            "source": f"al:{ALBUM}",
            "userid": userid,
        }
    )


def favorite(itemhash: str, timestamp: int, userid: int = 1):
    from aivinnet.db.userdata import FavoritesTable

    FavoritesTable.insert_one({"hash": itemhash, "type": "track", "timestamp": timestamp, "userid": userid})


def tiles(api, query: str = ""):
    res = api.get(f"/logger/stats{query}")
    assert res.status_code == 200, res.json
    return {item["cssclass"]: item for item in res.json["stats"]}


def test_without_a_period_the_tiles_still_cover_the_week(stats_api):
    """The search page's library numbers ask without a period."""
    scrobble(int(time.time()), 200)

    week = tiles(stats_api)

    assert week["streams"]["text"] == "this week"
    assert week["toptrack"]["text"] == "Top track this week"


@pytest.mark.parametrize(
    ("period", "said"),
    [("day", "today"), ("week", "this week"), ("month", "this month"), ("year", "this year"), ("alltime", "all time")],
)
def test_each_period_names_itself(stats_api, period, said):
    scrobble(int(time.time()), 200)

    shown = tiles(stats_api, f"?period={period}")

    assert shown["streams"]["text"] == said
    assert shown["playtime"]["text"] == said
    assert shown["toptrack"]["text"] == f"Top track {said}"


def test_a_play_from_last_year_counts_for_all_time_only(stats_api):
    now = int(time.time())
    scrobble(now, 200)
    scrobble(now - 400 * DAY, 100)

    for period in ("day", "week", "month", "year"):
        assert tiles(stats_api, f"?period={period}")["streams"]["value"] == "1 track play", period

    alltime = tiles(stats_api, "?period=alltime")
    assert alltime["streams"]["value"] == "2 track plays"
    assert alltime["playtime"]["value"] == "5 mins listened"


def test_all_time_counts_every_favorite_without_calling_it_new(stats_api):
    now = int(time.time())
    favorite("aaaa000000000001", now)
    favorite("aaaa000000000002", now - 400 * DAY)

    assert tiles(stats_api, "?period=week")["favorites"]["value"] == "1 new favorite"
    # Was "2  favorites": the empty word left a double space.
    assert tiles(stats_api, "?period=alltime")["favorites"]["value"] == "2 favorites"


def test_a_play_of_a_track_gone_from_the_library_is_a_play_but_no_time(stats_api):
    """Counted like before the tiles were grouped in SQL (`get_tracks_in_period`):
    the play happened, but its track can neither add time nor be the top track."""
    now = int(time.time())
    scrobble(now, 240)
    scrobble(now, 900, trackhash="ffff000000000000")

    shown = tiles(stats_api, "?period=alltime")

    assert shown["streams"]["value"] == "2 track plays"
    # 4 minutes, not 19: the orphan's 15 do not count.
    assert shown["playtime"]["value"] == "4 mins listened"
    assert shown["toptrack"]["trackhash"] == HASH


def test_another_users_plays_stay_theirs(stats_api):
    scrobble(int(time.time()), 200, userid=2)

    assert tiles(stats_api, "?period=alltime")["streams"]["value"] == "0 track plays"


def test_an_unknown_period_is_refused(stats_api):
    assert stats_api.get("/logger/stats?period=decade").status_code == 422
