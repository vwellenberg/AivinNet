"""
`GET /playlists` carries, per playlist, the requesting user's plays of it:
`playcount`, `playduration` (seconds) and `lastplayed` (unix ts, 0 = never).

Real request cycle and a real database. The client logs a play of a playlist
as a scrobble with `source = "pl:<playlist id>"`, so the counts are pinned
against those rows, including the look-alike sources that must NOT count.
"""

import pytest

PRIMUS_TRACKS = [
    "3f9c1a7e0b2d4e6f8a1b3c5d7e9f0a12",
    "9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
    "0e1d2c3b4a59687766554433221100ff",
]
OTHER_TRACK = "c2d4e6f8a0b1c3d5e7f9a1b3c5d7e9f1"
T0 = 1_700_000_000  # a fixed, realistic unix time


@pytest.fixture()
def scene(api_client, monkeypatch):
    """
    User 1 owns "played" (3 plays) and "quiet" (never played); user 2 owns
    "theirs". `handle.userid` switches the acting user.
    """
    import aivinnet.api.playlist as playlist_api
    from aivinnet.db.userdata import PlaylistTable, ScrobbleTable

    handle = api_client("aivinnet.api.playlist")
    monkeypatch.setattr(playlist_api, "get_current_userid", lambda: handle.userid)

    PlaylistTable.add_one({"name": "played", "userid": 1, "settings": {}, "last_updated": 0, "trackhashes": []})
    PlaylistTable.add_one({"name": "quiet", "userid": 1, "settings": {}, "last_updated": 0, "trackhashes": []})
    PlaylistTable.add_one({"name": "theirs", "userid": 2, "settings": {}, "last_updated": 0, "trackhashes": []})

    handle.userid = 1
    ids = {p.name: p.id for p in PlaylistTable.get_all()}

    def scrobble(source, trackhash, duration, timestamp, userid=1):
        ScrobbleTable.add(
            {
                "trackhash": trackhash,
                "duration": duration,
                "timestamp": timestamp,
                "source": source,
                "userid": userid,
            }
        )

    pid = ids["played"]
    scrobble(f"pl:{pid}", PRIMUS_TRACKS[0], 180, T0)
    scrobble(f"pl:{pid}", PRIMUS_TRACKS[1], 240, T0 + 3600)
    scrobble(f"pl:{pid}", PRIMUS_TRACKS[2], 200, T0 + 7200)

    return handle, ids, scrobble


def _by_name(handle, query=""):
    res = handle.get(f"/playlists{query}")
    assert res.status_code == 200, res.text
    return {p["name"]: p for p in res.get_json()["data"]}


def test_played_playlist_carries_count_sum_and_last_play(scene):
    handle, _, _ = scene

    played = _by_name(handle)["played"]

    assert played["playcount"] == 3
    assert played["playduration"] == 180 + 240 + 200
    assert played["lastplayed"] == T0 + 7200


def test_never_played_playlist_is_all_zero(scene):
    handle, _, _ = scene

    quiet = _by_name(handle)["quiet"]

    assert (quiet["playcount"], quiet["playduration"], quiet["lastplayed"]) == (0, 0, 0)


def test_another_users_plays_of_the_same_playlist_id_do_not_count(scene):
    handle, ids, scrobble = scene
    # User 2 plays user 1's playlist id: it must not show up for user 1.
    scrobble(f"pl:{ids['played']}", OTHER_TRACK, 999, T0 + 99999, userid=2)

    played = _by_name(handle)["played"]

    assert played["playcount"] == 3
    assert played["playduration"] == 620
    assert played["lastplayed"] == T0 + 7200


def test_other_sources_do_not_count_for_this_playlist(scene):
    handle, ids, scrobble = scene
    pid = ids["played"]
    scrobble(f"al:{pid}", OTHER_TRACK, 500, T0 + 80000)  # album source, same number
    scrobble(f"pf:{pid}", OTHER_TRACK, 500, T0 + 81000)  # folder source, same number
    scrobble(f"pl:{ids['quiet']}", OTHER_TRACK, 500, T0 + 82000)  # a different playlist

    by_name = _by_name(handle)

    assert by_name["played"]["playcount"] == 3
    assert by_name["played"]["playduration"] == 620
    assert by_name["played"]["lastplayed"] == T0 + 7200
    assert by_name["quiet"]["playcount"] == 1
    assert by_name["quiet"]["playduration"] == 500
    assert by_name["quiet"]["lastplayed"] == T0 + 82000


def test_stats_survive_no_images(scene):
    handle, _, _ = scene

    played = _by_name(handle, "?no_images=true")["played"]

    assert played["playcount"] == 3
    assert played["playduration"] == 620
    assert played["lastplayed"] == T0 + 7200


def test_the_list_carries_each_playlists_duration(api_client, monkeypatch):
    """
    The Playlists page sorts by "Duration", and the list used to send 0 for
    every playlist (only the detail page summed its tracks). The sum covers
    the tracks still in the library; an orphan hash adds nothing.
    """
    from test_home_discover_api import PRIMUS, _track

    import aivinnet.api.playlist as playlist_api
    from aivinnet.db.userdata import PlaylistTable
    from aivinnet.store.tracks import TrackGroup, TrackStore

    tracks = [_track(PRIMUS, n) for n in (1, 2, 3)]
    for track, seconds in zip(tracks, (180, 240, 205)):
        track.duration = seconds
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in tracks})

    handle = api_client("aivinnet.api.playlist")
    monkeypatch.setattr(playlist_api, "get_current_userid", lambda: handle.userid)
    handle.userid = 1
    hashes = [t.trackhash for t in tracks]
    PlaylistTable.add_one({"name": "long", "userid": 1, "settings": {}, "last_updated": 0, "trackhashes": hashes})
    PlaylistTable.add_one(
        {"name": "short", "userid": 1, "settings": {}, "last_updated": 0, "trackhashes": [hashes[0], "f" * 16]}
    )

    by_name = _by_name(handle, "?no_images=true")

    assert by_name["long"]["duration"] == 180 + 240 + 205
    assert by_name["short"]["duration"] == 180
    assert by_name["short"]["count"] == 2  # the count stays the stored list's length
