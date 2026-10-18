"""`GET /logger/stats` — the "Top track this week" tile.

The tile's cover used to open the album only. Playing the track needs its
hash, and the stat carried none: the client could not tell which track of the
album the tile was about.
"""

from types import SimpleNamespace

HASH = "0853280a12c4f9e1"
ALBUM = "a1b2c3d4e5f60718"


def make_track():
    return SimpleNamespace(
        trackhash=HASH,
        title="Blue",
        artists=[{"name": "The Artist"}],
        # The real shape: the entity travels as a query on the image name.
        image=f"{ALBUM}.webp?pathhash=0a1b2c3d4e5f6071&fb=track",
        playduration=300,
    )


def stats(api_client, monkeypatch, tracks):
    import aivinnet.api.scrobble as scrobble_api

    monkeypatch.setattr(scrobble_api, "get_tracks_in_period", lambda *_: (tracks, len(tracks), 300))
    monkeypatch.setattr(scrobble_api.TrackStore, "get_flat_list", staticmethod(lambda: tracks), raising=False)
    api = api_client("aivinnet.api.scrobble")
    res = api.get("/logger/stats")
    assert res.status_code == 200
    return {item["cssclass"]: item for item in res.json["stats"]}


def test_the_top_track_tile_names_its_track(api_client, monkeypatch):
    tile = stats(api_client, monkeypatch, [make_track()])["toptrack"]

    assert tile["trackhash"] == HASH
    assert tile["image"].startswith(f"{ALBUM}.webp")


def test_an_empty_week_has_no_track_to_play(api_client, monkeypatch):
    tile = stats(api_client, monkeypatch, [])["toptrack"]

    assert tile["value"] == "—"
    assert tile["trackhash"] is None
