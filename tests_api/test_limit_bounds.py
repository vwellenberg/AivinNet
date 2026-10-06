"""List parameters are bounded, and a nonsense value is a 422, not a 500 (#295).

The server answers one request at a time, so `limit=1000000` made one caller
serialise as much as it liked while everyone else waited; a negative card
limit fell through to a slice and answered 500. The values the client really
sends stay valid: -1 ("all") for a playlist and the favourites, 0 for the
discography (`albumlimit=0&all=true`).
"""

import pytest

ARTIST = "0123456789abcdef"


@pytest.fixture()
def api(api_client, monkeypatch):
    import aivinnet.api.home as home

    monkeypatch.setattr(home, "get_recently_added_items", lambda limit: [])
    monkeypatch.setattr(home, "get_recently_played", lambda limit: [])
    return api_client("aivinnet.api.home", "aivinnet.api.artist", "aivinnet.api.favorites", "aivinnet.api.playlist")


@pytest.mark.parametrize(
    "url",
    [
        "/nothome/recents/added?limit=100000",
        "/nothome/recents/added?limit=0",
        "/nothome/recents/played?limit=-1",
        f"/artist/{ARTIST}?tracklimit=501",
        f"/artist/{ARTIST}?albumlimit=-1",
        f"/artist/{ARTIST}/similar?artistlimit=-5",
        "/favorites/tracks?start=0&limit=-2",
        "/favorites/albums?start=-1&limit=6",
        "/playlists/1?start=-1",
    ],
)
def test_out_of_range_is_refused(api, url):
    assert api.get(url).status_code == 422, url


@pytest.mark.parametrize(
    "url",
    [
        "/nothome/recents/added?limit=10",
        "/favorites/tracks?start=0&limit=-1",  # usePlayFrom: play all favourites
        f"/artist/{ARTIST}/albums?albumlimit=0&all=true",  # the discography page
        f"/artist/{ARTIST}?tracklimit=5&albumlimit=7",
        "/playlists/1?limit=-1",  # a whole playlist
    ],
)
def test_what_the_client_sends_still_passes_validation(api, url):
    # 404 is fine here (no such artist or playlist in the fixture); 422 is not.
    assert api.get(url).status_code != 422, url
