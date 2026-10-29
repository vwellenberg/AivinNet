"""`GET /logger/skips` — the skip quote on the stats page (#537).

Real request cycle and real `ScrobbleTable` rows: the grouping per track and
listened length runs in SQLite. The library is stubbed to the track lengths
and the serializer, which the fast lane cannot reach.
"""

import time
from types import SimpleNamespace

import pytest

SKIPPED = "5b1d0c7e2a9f4e10"
FINISHED = "9e3f1a0b6c2d8e47"
GONE = "0c4e7a1f9b2d3e58"  # played, but no longer in the library
ALBUM = "a1b2c3d4e5f60718"


@pytest.fixture()
def skips_api(api_client, monkeypatch):
    import aivinnet.api.scrobble as scrobble_api

    api = api_client("aivinnet.api.scrobble")
    monkeypatch.setattr(scrobble_api, "get_current_userid", lambda: api.userid)
    # Ids restart after the between-tests wipe: a cache from another test
    # could match this one's marker.
    monkeypatch.setattr(scrobble_api, "_skips", {})

    lengths = {SKIPPED: 200, FINISHED: 200}
    monkeypatch.setattr(
        scrobble_api.TrackStore,
        "get_tracks_by_trackhashes",
        lambda hashes: [SimpleNamespace(trackhash=h, duration=lengths[h]) for h in set(hashes) if h in lengths],
    )
    monkeypatch.setattr(
        scrobble_api, "serialize_track", lambda track: {"trackhash": track.trackhash, "album": ALBUM}
    )
    return api


def plays(trackhash: str, seconds: int, count: int = 1, when: int | None = None, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    for _ in range(count):
        ScrobbleTable.add(
            {
                "trackhash": trackhash,
                "timestamp": when if when is not None else int(time.time()),
                "duration": seconds,
                "source": f"al:{ALBUM}",
                "userid": userid,
            }
        )


def skips(api, period: str = "week"):
    res = api.get(f"/logger/skips?period={period}")
    assert res.status_code == 200, res.json
    return res.json


def test_the_skipped_and_the_finished_track_are_ranked(skips_api):
    plays(SKIPPED, 10, 5)
    plays(FINISHED, 195, 5)

    body = skips(skips_api)

    assert body["plays"] == 10
    assert body["skipped"] == 5
    assert body["rate"] == 0.5
    assert [row["trackhash"] for row in body["most_skipped"]] == [SKIPPED]
    assert body["most_skipped"][0]["share"] == 1.0
    assert body["most_skipped"][0]["track"] == {"trackhash": SKIPPED, "album": ALBUM}
    assert [row["trackhash"] for row in body["to_the_end"]] == [FINISHED]
    assert body["to_the_end"][0]["finished"] == 5
    assert body["rules"]["min_plays"] == 5
    assert body["dates"]


def test_a_play_of_a_track_gone_from_the_library_is_not_counted(skips_api):
    plays(GONE, 5, 20)
    plays(SKIPPED, 10, 1)

    body = skips(skips_api)

    assert body["plays"] == 1
    assert body["skipped"] == 1
    assert body["most_skipped"] == []


def test_the_period_bounds_the_plays(skips_api):
    plays(SKIPPED, 10, 5, when=int(time.time()) - 60 * 86400)

    assert skips(skips_api, "week")["rate"] is None
    assert skips(skips_api, "alltime")["plays"] == 5


def test_each_user_has_their_own_quote(skips_api):
    plays(FINISHED, 195, 5, userid=2)

    assert skips(skips_api)["plays"] == 0
    skips_api.userid = 2
    assert skips(skips_api)["plays"] == 5


def test_a_new_play_shows_at_once(skips_api):
    plays(SKIPPED, 10, 5)
    assert skips(skips_api)["plays"] == 5

    plays(FINISHED, 195, 1)
    assert skips(skips_api)["plays"] == 6


def test_an_unknown_period_is_refused(skips_api):
    assert skips_api.get("/logger/skips?period=decade").status_code == 422
