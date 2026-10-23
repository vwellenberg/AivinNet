"""
"New to you" on the stats page (#539): the tile, the list behind it
(`GET /logger/discoveries`) and the chart captions, which now say the same.

Real request cycle and real scrobbles, on the library of
`test_home_discover_api` (built through the real models). "New" is the first
play EVER: the album captions used to compare with the period before only, so
an album last heard a month ago came back as "new".
"""

import pytest
from test_home_discover_api import (  # noqa: F401
    FNM,
    MILES,
    PRIMUS,
    RHCP,
    UNTAGGED,
    artisthash,
    history,
    home,
    scrobble,
    th,
)

DAY = 86400


@pytest.fixture()
def stats(home, api_client, monkeypatch):  # noqa: F811 - the imported fixture
    import aivinnet.api.scrobble as scrobble_api
    import aivinnet.lib.first_play_cache as first_play_cache

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    # Kept per user until the next play: a fresh one per test, whose plays
    # may repeat the last test's count and highest id.
    monkeypatch.setattr(first_play_cache, "_first_plays", {})
    return api


def tile(api, period="week"):
    res = api.get(f"/logger/stats?period={period}")
    assert res.status_code == 200, res.text
    return next(t for t in res.get_json()["stats"] if t["cssclass"] == "discoveries")


def discoveries(api, period="week"):
    res = api.get(f"/logger/discoveries?period={period}")
    assert res.status_code == 200, res.text
    return res.get_json()


def caption(api, chart):
    res = api.get(f"/logger/top-{chart}?duration=week&limit=10")
    assert res.status_code == 200, res.text
    return res.get_json()["scrobbles"]["text"]


def test_an_album_and_an_artist_first_heard_this_week(stats, history):
    scrobble(th(PRIMUS, 1), history - 3600)

    shown = tile(stats)

    assert shown["value"] == "1 artist · 1 album"
    assert shown["text"] == "new this week"


def test_an_album_heard_before_is_not_new_when_it_comes_back(stats, history):
    # Faith No More: a long history months ago, played again now. Red Hot
    # Chili Peppers: all over this week, but first heard 40 days ago. Neither
    # played the week before — which made both "new" in the album caption.
    scrobble(th(FNM, 1), history - 3600)

    assert caption(stats, "albums") == "0 new albums played"
    assert caption(stats, "artists").startswith("0 new artists")
    assert tile(stats)["value"] == "0 artists · 0 albums"


def test_the_captions_count_what_the_tile_counts(stats, history):
    scrobble(th(PRIMUS, 1), history - 3600)
    scrobble(th(MILES, 1), history - 7200)

    assert tile(stats)["value"] == "2 artists · 2 albums"
    assert caption(stats, "albums") == "2 new albums played"
    assert caption(stats, "artists").startswith("2 new artists")


def test_over_all_time_everything_heard_counts_and_nothing_is_called_new(stats, history):
    shown = tile(stats, "alltime")
    assert shown["value"] == "2 artists · 2 albums"
    assert shown["text"] == "heard all time"


def test_the_list_behind_the_tile_latest_discovery_first(stats, history):
    scrobble(th(MILES, 1), history - 7200)
    scrobble(th(PRIMUS, 1), history - 3600)
    scrobble(th(PRIMUS, 2), history - 60)  # a second play is no second discovery

    found = discoveries(stats)

    assert [a["item"]["albumhash"] for a in found["albums"]] == [PRIMUS, MILES]
    assert [a["item"]["name"] for a in found["artists"]] == ["Primus", "Miles Davis"]
    assert all(c["type"] == "album" for c in found["albums"])
    assert found["albums"][0]["item"]["help_text"].startswith("first played ")
    assert found["albums"][0]["item"]["image"] == f"{PRIMUS}.webp?pathhash=ph-Frizzle Fry"
    assert found["total"] == {"artists": 2, "albums": 2}


def test_nobody_is_no_discovery_but_their_album_is(stats, history):
    scrobble(th(UNTAGGED, 1), history - 3600)

    assert tile(stats)["value"] == "0 artists · 1 album"


def test_a_new_play_is_counted_at_once(stats, history):
    assert tile(stats)["value"] == "0 artists · 0 albums"

    scrobble(th(PRIMUS, 1), history - 60)

    assert tile(stats)["value"] == "1 artist · 1 album"


def test_each_user_discovers_on_their_own(stats, history):
    scrobble(th(PRIMUS, 1), history - 3600, userid=2)

    assert tile(stats)["value"] == "0 artists · 0 albums"
    stats.userid = 2
    assert tile(stats)["value"] == "1 artist · 1 album"


def test_the_list_is_bounded(stats, history):
    scrobble(th(MILES, 1), history - 7200)
    scrobble(th(PRIMUS, 1), history - 3600)

    found = stats.get("/logger/discoveries?period=week&limit=1").get_json()

    assert len(found["albums"]) == 1 and found["total"]["albums"] == 2
    assert stats.get("/logger/discoveries?limit=501").status_code == 422
    assert stats.get("/logger/discoveries?period=decade").status_code == 422


def test_tile_captions_and_list_count_the_same_set(stats, history, monkeypatch):
    # An artist still on a track's tags but gone from the artist pages (a
    # rescan in flight): the list could not show it, so nothing counts it.
    from aivinnet.store.artists import ArtistStore

    scrobble(th(PRIMUS, 1), history - 3600)
    scrobble(th(MILES, 1), history - 7200)
    monkeypatch.delitem(ArtistStore.artistmap, artisthash(PRIMUS))

    assert tile(stats)["value"] == "1 artist · 2 albums"
    assert caption(stats, "artists").startswith("1 new artist")
    found = discoveries(stats)
    assert [a["item"]["name"] for a in found["artists"]] == ["Miles Davis"]
    assert found["total"] == {"artists": 1, "albums": 2}


def test_red_hot_chili_peppers_was_heard_before_the_week(stats, history):
    """The guard over the scenario: the history the tests above lean on."""
    scrobble(th(RHCP, 1), history - 60)

    assert tile(stats)["value"] == "0 artists · 0 albums"
