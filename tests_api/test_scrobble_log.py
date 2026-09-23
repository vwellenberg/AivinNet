"""`POST /logger/track/log` — the most-called write path in the app, and until
now the only one with no test at all (AivinNet#136, point 5).

Every played track ends up here, and everything personal is derived from what
it writes: the mixes, the recommendations, "recently played", the charts. It
also fails quietly by design — the client posts from a Web Worker and never
looks at the answer, so a rejected scrobble leaves no trace anywhere in the UI.
A listening history that slowly stops being recorded looks exactly like a
library nobody plays.

That worker (`client/public/workers/logtrack.js`) is also why the request is
pinned here field by field: it builds its own body with `fetch`, so it bypasses
`src/requests/` and with it the client/server contract check in
`requestContract.test.ts`. This file is the other end of that payload.
"""

from types import SimpleNamespace

import pytest

HASH = "0853280a12c4f9e1"  # 16 chars — TrackHashSchema enforces the length
ALBUM = "a1b2c3d4e5f60718"
ARTIST = "1122334455667788"
TIMESTAMP = 1790000000


class Counter:
    """Stands in for a store entry: records what was added to its play counts."""

    def __init__(self):
        self.calls: list[tuple[int, int]] = []

    def increment_playcount(self, duration: int, timestamp: int):
        self.calls.append((duration, timestamp))


def make_track(duration: int = 300):
    return SimpleNamespace(
        trackhash=HASH,
        albumhash=ALBUM,
        artisthashes=[ARTIST],
        duration=duration,
        playcount=0,
        playduration=0,
        lastplayed=0,
        title="Blue",
        album="Blue Album",
        artists=[{"name": "The Artist"}],
        albumartists=[{"name": "The Artist"}],
    )


@pytest.fixture()
def logger(api_client, monkeypatch):
    """The real endpoint and a real database; the RAM stores stand in."""
    import aivinnet.api.scrobble as scrobble_api
    from aivinnet.store.tracks import TrackGroup

    state = SimpleNamespace(
        track=make_track(),
        album=Counter(),
        artist=Counter(),
        lastfm_enabled=True,
        scrobbled=[],
        recents=[],
    )
    state.group = TrackGroup([state.track])

    monkeypatch.setattr(scrobble_api.TrackStore, "trackhashmap", {HASH: state.group}, raising=False)
    monkeypatch.setattr(scrobble_api.AlbumStore, "albummap", {ALBUM: state.album}, raising=False)
    monkeypatch.setattr(scrobble_api.ArtistStore, "artistmap", {ARTIST: state.artist}, raising=False)
    monkeypatch.setattr(scrobble_api, "get_extra_info", lambda *_: {})
    monkeypatch.setattr(scrobble_api, "RecentlyPlayed", lambda userid: state.recents.append(userid))

    class FakeLastFm:
        def __init__(self, current_userid: int):
            self.current_userid = current_userid

        @property
        def enabled(self):
            return state.lastfm_enabled

        def scrobble(self, track, timestamp):
            state.scrobbled.append((track.trackhash, timestamp))

    monkeypatch.setattr(scrobble_api, "LastFmPlugin", FakeLastFm)

    state.api = api_client("aivinnet.api.scrobble")
    return state


def log(api, **overrides):
    """A body shaped exactly like the one the client's worker posts."""
    body = {"trackhash": HASH, "duration": 200, "source": f"al:{ALBUM}", "timestamp": TIMESTAMP}
    body.update(overrides)
    return api.post("/logger/track/log", json=body)


def scrobbles(api):
    from aivinnet.db.userdata import ScrobbleTable

    return list(ScrobbleTable.get_all(start=0, userid=api.userid))


def test_a_played_track_is_recorded_and_counted(logger):
    res = log(logger.api)

    assert res.status_code == 201
    assert res.json == {"msg": "recorded"}

    (entry,) = scrobbles(logger.api)
    assert (entry.trackhash, entry.duration, entry.timestamp) == (HASH, 200, TIMESTAMP)
    assert entry.source == f"al:{ALBUM}"
    assert entry.userid == logger.api.userid

    # The RAM stores carry the play counts until the next restart; a write that
    # only reached SQLite would show up nowhere until then.
    assert logger.track.playcount == 1
    assert logger.track.playduration == 200
    assert logger.track.lastplayed == TIMESTAMP
    assert logger.album.calls == [(200, TIMESTAMP)]
    assert logger.artist.calls == [(200, TIMESTAMP)]
    assert logger.recents == [logger.api.userid]


@pytest.mark.parametrize(
    ("overrides", "why"),
    [
        ({"duration": 4}, "under the 5 s floor"),
        ({"timestamp": 0}, "no timestamp"),
    ],
)
def test_an_invalid_entry_is_rejected_and_writes_nothing(logger, overrides, why):
    res = log(logger.api, **overrides)

    assert res.status_code == 400, why
    assert scrobbles(logger.api) == []
    assert logger.track.playcount == 0


def test_five_seconds_is_recorded_the_floor_is_not_off_by_one(logger):
    assert log(logger.api, duration=5).status_code == 201
    assert len(scrobbles(logger.api)) == 1


def test_an_unknown_track_is_not_recorded(logger):
    res = log(logger.api, trackhash="ffffffffffffffff")

    assert res.status_code == 404
    assert scrobbles(logger.api) == []


def test_a_malformed_trackhash_never_reaches_the_handler(logger):
    # TrackHashSchema pins the length; flask_openapi3 answers 422 before the
    # handler runs, so the store is never consulted.
    assert log(logger.api, trackhash="short").status_code == 422
    assert scrobbles(logger.api) == []


@pytest.mark.parametrize(
    ("source", "expected_type", "expected_src"),
    [
        (f"al:{ALBUM}", "album", ALBUM),
        (f"ar:{ARTIST}", "artist", ARTIST),
        ("fo:/music/jazz", "folder", "/music/jazz"),
        ("pl:7", "playlist", "7"),
        ("favorite", "favorite", None),
        # The client also sends these two; the server knows no prefix for them,
        # so they stay plain track plays instead of being mis-attributed.
        ("pf:3", "track", None),
        ("q:blue", "track", None),
    ],
)
def test_every_source_the_client_sends_survives_the_round_trip(logger, source, expected_type, expected_src):
    assert log(logger.api, source=source).status_code == 201

    (entry,) = scrobbles(logger.api)
    assert entry.source == source
    assert entry.type == expected_type
    assert entry.type_src == expected_src


def test_each_user_only_sees_their_own_history(logger):
    log(logger.api)
    logger.api.userid = 2
    log(logger.api, timestamp=TIMESTAMP + 60)

    assert [e.timestamp for e in scrobbles(logger.api)] == [TIMESTAMP + 60]
    assert [e.userid for e in scrobbles(logger.api)] == [2]


class TestLastFm:
    """Last.fm has its own idea of what counts as a play; the row above is
    written either way. (The call itself runs in a background thread — see
    tests_api/test_lastfm_outbound.py for the deadline it needs.)"""

    def test_half_the_track_is_scrobbled(self, logger):
        log(logger.api, duration=150)  # track is 300 s
        assert logger.scrobbled == [(HASH, TIMESTAMP)]

    def test_a_short_listen_is_not(self, logger):
        log(logger.api, duration=100)
        assert logger.scrobbled == []
        assert len(scrobbles(logger.api)) == 1, "the local history keeps it regardless"

    def test_a_track_under_30_seconds_is_never_scrobbled(self, logger):
        logger.track.duration = 20
        log(logger.api, duration=20)
        assert logger.scrobbled == []

    def test_four_minutes_is_enough_for_a_long_track(self, logger):
        logger.track.duration = 3600  # half of this would never be reached
        log(logger.api, duration=240)
        assert logger.scrobbled == [(HASH, TIMESTAMP)]

    def test_nothing_leaves_the_house_when_the_plugin_is_off(self, logger):
        logger.lastfm_enabled = False
        log(logger.api, duration=150)
        assert logger.scrobbled == []
