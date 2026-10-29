"""`GET /logger/library` — the library tiles on the stats page (#536).

Real request cycle and real `ScrobbleTable` rows: the heard set is one SQL read.
The library is stubbed to plain tracks, since the fast lane cannot reach the
store. The generation test below runs the real `TrackStore` mutators.
"""

import time
from types import SimpleNamespace

import pytest

HEARD = "5b1d0c7e2a9f4e10"
UNHEARD = "9e3f1a0b6c2d8e47"
ALBUM_A = "a1b2c3d4e5f60718"
ALBUM_B = "b2c3d4e5f6071829"


def stub_track(trackhash, albumhash, duration=200, bitrate=320, filepath=None, extra=None):
    return SimpleNamespace(
        trackhash=trackhash,
        albumhash=albumhash,
        duration=duration,
        bitrate=bitrate,
        filepath=filepath or f"/music/{trackhash}.mp3",
        extra=extra if extra is not None else {},
    )


@pytest.fixture()
def library_api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api
    from aivinnet.store.tracks import TrackStore

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    # Caches from another test could match this one's keys: start empty.
    monkeypatch.setattr(scrobble_api, "_library_totals", None)
    monkeypatch.setattr(scrobble_api, "_explored", {})

    state = {
        "tracks": [
            stub_track(HEARD, ALBUM_A, extra={"samplerate": 96000, "bitdepth": 24}, filepath="/music/a.flac"),
            stub_track(UNHEARD, ALBUM_B, duration=100, bitrate=0, filepath="/music/b.mp3"),
        ]
    }
    monkeypatch.setattr(TrackStore, "get_flat_list", staticmethod(lambda: list(state["tracks"])))
    monkeypatch.setattr(TrackStore, "generation", 1)
    api.state = state
    return api


def play(trackhash: str, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {
            "trackhash": trackhash,
            "timestamp": int(time.time()),
            "duration": 200,
            "source": "al:x",
            "userid": userid,
        }
    )


def bump_library_generation():
    from aivinnet.store.tracks import TrackStore

    TrackStore.generation += 1


def library(api):
    res = api.get("/logger/library")
    assert res.status_code == 200, res.json
    return res.json


def test_the_tiles_count_the_heard_share_the_length_and_the_files(library_api):
    play(HEARD)

    body = library(library_api)

    assert body["explored"]["tracks"] == {"heard": 1, "total": 2, "share": 0.5}
    assert body["explored"]["albums"] == {"heard": 1, "total": 2, "share": 0.5}
    assert body["nonstop_seconds"] == 300
    assert body["files"] == 2
    assert body["formats"] == [
        {"format": "FLAC", "files": 1, "share": 0.5},
        {"format": "MP3", "files": 1, "share": 0.5},
    ]
    # The one file with a known bitrate: the FLAC's, unknown for the MP3 (0).
    assert body["mean_bitrate"] == 320
    assert body["hires"] == {"files": 1, "share": 0.5}


def test_an_empty_library_answers_with_no_shares(library_api):
    library_api.state["tracks"] = []
    bump_library_generation()

    body = library(library_api)

    assert body["explored"]["tracks"]["share"] is None
    assert body["nonstop_seconds"] == 0
    assert body["formats"] == []
    assert body["mean_bitrate"] is None


def test_each_user_has_their_own_explored_share(library_api):
    play(HEARD, userid=2)

    assert library(library_api)["explored"]["tracks"]["heard"] == 0

    library_api.userid = 2
    assert library(library_api)["explored"]["tracks"]["heard"] == 1


def test_a_new_play_shows_at_once(library_api):
    assert library(library_api)["explored"]["tracks"]["heard"] == 0

    play(HEARD)

    assert library(library_api)["explored"]["tracks"]["heard"] == 1


def test_the_library_numbers_are_cached_until_the_library_changes(library_api):
    import aivinnet.api.scrobble as scrobble_api
    from aivinnet.store.tracks import TrackStore

    assert library(library_api)["nonstop_seconds"] == 300

    # Same generation: the cache answers, whatever the store holds now.
    library_api.state["tracks"].append(stub_track("c" * 16, ALBUM_B, duration=1000))
    assert library(library_api)["nonstop_seconds"] == 300

    bump_library_generation()
    assert library(library_api)["nonstop_seconds"] == 1300
    assert scrobble_api._library_totals[0] == TrackStore.generation


def test_a_track_without_tag_extras_is_not_hi_res(library_api):
    # `Track.extra` can be None; the tiles read it as no tags at all.
    library_api.state["tracks"] = [SimpleNamespace(**{**vars(stub_track(HEARD, ALBUM_A)), "extra": None})]
    bump_library_generation()

    assert library(library_api)["hires"] == {"files": 0, "share": 0.0}


def test_store_mutations_bump_the_generation():
    from aivinnet.store.tracks import TrackStore

    # The real mutators, on a store of its own: a cache keyed on the generation
    # must see every add and removal.
    store_before = TrackStore.trackhashmap
    generation_before = TrackStore.generation
    TrackStore.trackhashmap = {}
    try:
        track = stub_track(HEARD, ALBUM_A, filepath="/music/a.mp3")
        start = TrackStore.generation

        TrackStore.add_track(track)
        assert TrackStore.generation > start

        after_add = TrackStore.generation
        TrackStore.remove_track(track)
        assert TrackStore.generation > after_add

        TrackStore.add_track(track)
        after_second_add = TrackStore.generation
        TrackStore.remove_track_by_filepath("/music/a.mp3")
        assert TrackStore.generation > after_second_add
    finally:
        TrackStore.trackhashmap = store_before
        TrackStore.generation = generation_before
