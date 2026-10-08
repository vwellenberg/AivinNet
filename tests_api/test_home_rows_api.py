"""
`GET /nothome/` with the personal rows "Continue listening", "Rediscover" and
"On this day", and `GET /nothome/surprise`.

Real request cycle, real SQLite scrobbles and playlists, real routines; only
the RAM library stores are filled by hand (the app fills them at boot).
"""

import pendulum
import pytest

ALBUM_A = "63e329a1b0641f44"  # played a lot, long ago
ALBUM_B = "0f1e2d3c4b5a6978"  # being listened to right now
DAY = 86400
ROW_ORDER = ["continue_listening", "recently_played", "rediscover", "on_this_day", "recently_added"]


# Filled by the fixture. `Track` derives its trackhash from title, album and
# artists (`recreate_trackhash`), exactly like the real library, so the hashes
# are read back from the built tracks instead of being made up.
TRACKHASHES: dict[tuple[str, int], str] = {}


def _trackhash(albumhash: str, n: int) -> str:
    return TRACKHASHES[(albumhash, n)]


def _track(albumhash: str, title: str, n: int):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    return Track(
        id=n,
        album=title,
        albumartists="Some Band",
        albumhash=albumhash,
        artists="Some Band",
        bitrate=256,
        copyright="",
        date=0,
        disc=1,
        duration=180,
        filepath=f"/music/{title}/{n:02}.flac",
        folder=f"/music/{title}",
        genres="",
        last_mod=0,
        title=f"Song {n}",
        track=n,
        trackhash="",
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
    )


def _album(albumhash: str, title: str):
    from aivinnet.models.album import Album

    return Album(
        albumartists=[{"name": "Some Band", "artisthash": "ah1"}],
        albumhash=albumhash,
        artisthashes=["ah1"],
        base_title=title,
        color="",
        created_date=0,
        date=0,
        duration=0,
        genres=[],
        genrehashes=[],
        og_title=title,
        title=title,
        trackcount=0,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
        pathhash=f"ph-{title}",
    )


@pytest.fixture()
def home(api_client, monkeypatch):
    """A two-album library (tracks listed out of order on purpose), empty rows."""
    import aivinnet.store.homepage as homepage
    from aivinnet.store.albums import AlbumMapEntry, AlbumStore
    from aivinnet.store.homepage import HomepageStore
    from aivinnet.store.tracks import TrackGroup, TrackStore

    tracks = [_track(ALBUM_A, "Old Love", n) for n in (3, 1, 2, 5, 4)]
    tracks += [_track(ALBUM_B, "Now Playing", n) for n in range(10, 0, -1)]
    TRACKHASHES.clear()
    TRACKHASHES.update({(t.albumhash, t.track): t.trackhash for t in tracks})

    albummap = {
        h: AlbumMapEntry(_album(h, title), {t.trackhash for t in tracks if t.albumhash == h})
        for h, title in ((ALBUM_A, "Old Love"), (ALBUM_B, "Now Playing"))
    }
    monkeypatch.setattr(AlbumStore, "albummap", albummap)
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in tracks})

    for entry in HomepageStore.entries.values():
        monkeypatch.setattr(entry, "items", {})
        monkeypatch.setattr(entry, "description", entry.description)
        # Per-user state of some rows (titles, chips, "Play that day").
        for attr in ("meta", "chips", "trackhashes"):
            if hasattr(entry, attr):
                monkeypatch.setattr(entry, attr, {})

    api = api_client("aivinnet.api.home", "aivinnet.api.scrobble")
    # The store asks auth for the user directly, not through the DB layer.
    monkeypatch.setattr(homepage, "get_current_userid", lambda: api.userid)
    return api


def scrobble(trackhash: str, timestamp: int, source: str, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add(
        {"trackhash": trackhash, "timestamp": timestamp, "duration": 180, "source": source, "userid": userid}
    )


def run_routines():
    from aivinnet.lib.recipes.continuelistening import ContinueListening
    from aivinnet.lib.recipes.homerows import OnThisDay, Rediscover
    from aivinnet.lib.recipes.recents import RecentlyPlayed

    RecentlyPlayed()
    ContinueListening()
    Rediscover()
    OnThisDay()


def rows(api):
    res = api.get("/nothome/?limit=9")
    assert res.status_code == 200, res.text
    return {k: v for row in res.get_json() for k, v in row.items()}, [k for row in res.get_json() for k in row]


def test_new_rows_their_shape_and_order(home):
    from aivinnet.store.homepage import HomepageStore

    now = int(pendulum.now().timestamp())
    year_ago = int(pendulum.now().subtract(years=1).start_of("day").add(hours=12).timestamp())

    for i in range(6):
        scrobble(_trackhash(ALBUM_A, 1 + i % 5), now - 200 * DAY + i, f"al:{ALBUM_A}")
    scrobble(_trackhash(ALBUM_A, 2), year_ago, f"al:{ALBUM_A}")
    scrobble(_trackhash(ALBUM_B, 4), now - 60, f"al:{ALBUM_B}")
    HomepageStore.entries["recently_added"].items[0] = [{"type": "album", "hash": ALBUM_B, "timestamp": now}]

    run_routines()
    data, order = rows(home)

    assert order == ROW_ORDER
    assert not any(k.startswith("top_streamed") for k in order)

    # Newest first: B is being listened to now; A (older, also unfinished) may
    # follow as a second card.
    cont = data["continue_listening"]["items"][0]
    assert data["continue_listening"]["title"] == "Continue listening"
    assert cont["type"] == "album"
    assert cont["item"]["albumhash"] == ALBUM_B
    assert (cont["item"]["track_index"], cont["item"]["track_total"]) == (3, 10)  # sorted by track number
    # Resume by the track itself (a playlist's index can be off by orphans).
    assert cont["item"]["resume_trackhash"] == _trackhash(ALBUM_B, 4)
    assert cont["item"]["image"] == f"{ALBUM_B}.webp?pathhash=ph-Now Playing"

    (redisc,) = data["rediscover"]["items"]
    assert data["rediscover"]["description"] == "You played these a lot — not lately"
    assert redisc["item"]["albumhash"] == ALBUM_A
    assert redisc["item"]["help_text"] == "7 plays"
    assert redisc["item"]["time"] == "last " + pendulum.from_timestamp(
        now - 200 * DAY + 5, tz=pendulum.local_timezone()
    ).format("MMMM YYYY")

    otd = data["on_this_day"]
    # The date and a line about the day: one 3-minute play at noon. No
    # "mostly …": this library has no artist pages to name.
    assert otd["description"] == pendulum.now().subtract(years=1).format("D MMMM YYYY") + " · 3 min · in the afternoon"
    assert [i["item"]["albumhash"] for i in otd["items"]] == [ALBUM_A]
    assert otd["items"][0]["item"]["help_text"] == f"{pendulum.now().year - 1} · 1 play"


def test_a_finished_album_is_not_continued(home):
    now = int(pendulum.now().timestamp())
    scrobble(_trackhash(ALBUM_A, 3), now - 600, f"al:{ALBUM_A}")
    scrobble(_trackhash(ALBUM_B, 10), now - 60, f"al:{ALBUM_B}")  # last track of B

    run_routines()
    data, _ = rows(home)

    (cont,) = data["continue_listening"]["items"]
    assert cont["item"]["albumhash"] == ALBUM_A
    assert (cont["item"]["track_index"], cont["item"]["track_total"]) == (2, 5)


def test_a_user_without_history_gets_no_personal_rows(home):
    now = int(pendulum.now().timestamp())
    scrobble(_trackhash(ALBUM_B, 4), now - 60, f"al:{ALBUM_B}", userid=1)
    from aivinnet.store.homepage import HomepageStore

    HomepageStore.entries["recently_added"].items[0] = [{"type": "album", "hash": ALBUM_B, "timestamp": now}]

    run_routines()
    home.userid = 2
    _, order = rows(home)

    assert order == ["recently_added"]


def test_a_user_created_after_startup_does_not_crash(home):
    from aivinnet.store.homepage import HomepageStore

    HomepageStore.add_new_user(99)
    home.userid = 99

    _, order = rows(home)
    assert order == []


def test_playlist_is_continued_only_for_its_owner(home):
    from sqlalchemy import insert

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import PlaylistTable

    trackhashes = [_trackhash(ALBUM_B, 7), _trackhash(ALBUM_A, 1), _trackhash(ALBUM_A, 4)]
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                id=7, name="Road trip", last_updated=0, image=None, userid=1, settings={}, trackhashes=trackhashes
            )
        )

    now = int(pendulum.now().timestamp())
    scrobble(_trackhash(ALBUM_A, 1), now - 60, "pl:7", userid=1)
    scrobble(_trackhash(ALBUM_A, 1), now - 60, "pl:7", userid=2)  # not user 2's playlist

    from aivinnet.lib.recipes.continuelistening import ContinueListening
    from aivinnet.store.homepage import HomepageStore

    ContinueListening()
    items = HomepageStore.entries["continue_listening"].items

    assert items[1] == [
        {
            "type": "playlist",
            "hash": "7",
            "trackhash": _trackhash(ALBUM_A, 1),
            "track_index": 1,
            "track_total": 3,
            "timestamp": now - 60,
        }
    ]
    assert items[2] == []


def test_a_scrobble_moves_continue_listening(home, monkeypatch):
    # Also the regression test for RecentlyPlayed's scrobble path: with no
    # store slot for the user yet it raised KeyError -> 500 after the write.
    import aivinnet.api.scrobble as scrobble_api

    monkeypatch.setattr(scrobble_api, "get_extra_info", lambda *_: {})

    class NoLastFm:
        enabled = False

        def __init__(self, current_userid):
            pass

    monkeypatch.setattr(scrobble_api, "LastFmPlugin", NoLastFm)
    now = int(pendulum.now().timestamp())

    def log(n: int):
        body = {"trackhash": _trackhash(ALBUM_B, n), "duration": 180, "source": f"al:{ALBUM_B}", "timestamp": now + n}
        assert home.post("/logger/track/log", json=body).status_code == 201

    log(5)
    data, _ = rows(home)
    assert data["continue_listening"]["items"][0]["item"]["track_index"] == 4

    log(10)  # the album is finished
    data, _ = rows(home)
    assert "continue_listening" not in data


def test_surprise_on_an_empty_library(home, monkeypatch):
    from aivinnet.store.albums import AlbumStore

    monkeypatch.setattr(AlbumStore, "albummap", {})

    res = home.get("/nothome/surprise")
    assert res.status_code == 200
    assert res.get_json() == {"albumhash": None}


def test_surprise_picks_an_album_from_the_library(home):
    picks = {home.get("/nothome/surprise").get_json()["albumhash"] for _ in range(40)}

    assert picks <= {ALBUM_A, ALBUM_B}
    assert picks == {ALBUM_A, ALBUM_B}  # 2**-39 chance of a false red


def test_every_entry_has_a_place_in_the_order():
    from aivinnet.store.homepage import HomepageStore

    ordered = HomepageStore.ORDER_BEFORE_PAGES + HomepageStore.ORDER_AFTER_PAGES
    assert sorted(ordered) == sorted(HomepageStore.entries)


def test_a_play_from_on_this_day_makes_no_recently_played_card(home):
    """Its content is one day's: a card for it tomorrow would play another day."""
    from aivinnet.lib.recipes.recents import RecentlyPlayed
    from aivinnet.store.homepage import HomepageStore

    now = int(pendulum.now().timestamp())
    scrobble(_trackhash(ALBUM_A, 1), now - 120, "pl:onthisday")
    scrobble(_trackhash(ALBUM_B, 2), now - 60, f"al:{ALBUM_B}")

    RecentlyPlayed()

    items = HomepageStore.entries["recently_played"].items[1]
    assert [(i["type"], i["hash"]) for i in items] == [("album", ALBUM_B)]
