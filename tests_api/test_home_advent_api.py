"""
The Advent calendar (`GET /nothome/advent`) through the real request cycle:
the doors up to today, each with its album as a Home card, and what stays
put while the days go by.

The library is real `Album`/`Track` objects in the stores, the plays are real
SQLite scrobbles, and the date is patched (`recap_today`), so the window does
not depend on when the suite runs.
"""

from datetime import date

import pendulum
import pytest

DAY = 86400
RELEASE = 1_000_000_000

# album hash -> (title, album artist)
ALBUMS: dict[str, tuple[str, str]] = {f"adv{n:02}": (f"Album {n}", f"Artist {n % 4}") for n in range(12)}
TRACKS_PER_ALBUM = 3
TRACKS: dict[tuple[str, int], object] = {}


def _track(albumhash: str, n: int):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    title, artist = ALBUMS[albumhash]
    return Track(
        id=n,
        album=title,
        albumartists=artist,
        albumhash=albumhash,
        artists=artist,
        bitrate=320,
        copyright="",
        date=RELEASE,
        disc=1,
        duration=200,
        filepath=f"/music/{title}/{n:02}.flac",
        folder=f"/music/{title}",
        genres="Rock",
        last_mod=RELEASE,
        title=f"{title} {n}",
        track=n,
        trackhash="",
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
    )


def _album(albumhash: str, tracks):
    from aivinnet.models.album import Album

    title, artist = ALBUMS[albumhash]
    first = tracks[0]
    return Album(
        albumartists=first.albumartists,
        albumhash=albumhash,
        artisthashes=[a["artisthash"] for a in first.albumartists],
        base_title=title,
        color="#336699",
        created_date=0,
        date=RELEASE,
        duration=0,
        genres=first.genres,
        genrehashes=" ".join(first.genrehashes),
        og_title=title,
        title=title,
        trackcount=len(tracks),
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
        pathhash=f"ph-{albumhash}",
        # As the album list serves it: the cover URL carries the path hash.
        image=f"{albumhash}.webp?pathhash=ph-{albumhash}",
    )


def th(albumhash: str, n: int = 1) -> str:
    return TRACKS[(albumhash, n)].trackhash


@pytest.fixture()
def calendar(api_client, monkeypatch):
    import aivinnet.api.home as home_api
    import aivinnet.lib.home.advent_calendar as advent_calendar
    from aivinnet.store.albums import AlbumMapEntry, AlbumStore
    from aivinnet.store.tracks import TrackGroup, TrackStore

    # The calendar's caches outlive a test; each test starts with none.
    monkeypatch.setattr(advent_calendar, "_made", {})
    monkeypatch.setattr(advent_calendar, "_plays", {})

    TRACKS.clear()
    for albumhash in ALBUMS:
        for n in range(1, TRACKS_PER_ALBUM + 1):
            TRACKS[(albumhash, n)] = _track(albumhash, n)

    albummap = {}
    for albumhash in ALBUMS:
        tracks = [t for (a, _), t in TRACKS.items() if a == albumhash]
        albummap[albumhash] = AlbumMapEntry(_album(albumhash, tracks), {t.trackhash for t in tracks})

    monkeypatch.setattr(AlbumStore, "albummap", albummap)
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in TRACKS.values()})

    api = api_client("aivinnet.api.home")
    monkeypatch.setattr(home_api, "get_current_userid", lambda: api.userid)
    monkeypatch.setattr(home_api, "recap_today", lambda: date(2026, 12, 5))
    return api


def set_day(monkeypatch, today: date):
    import aivinnet.api.home as home_api

    monkeypatch.setattr(home_api, "recap_today", lambda: today)


def scrobble(trackhash: str, timestamp: int, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add({"trackhash": trackhash, "timestamp": timestamp, "duration": 200, "source": "", "userid": userid})


def advent(calendar) -> dict:
    res = calendar.get("/nothome/advent")
    assert res.status_code == 200, res.text
    return res.get_json()


def door_hashes(body: dict) -> list[str]:
    return [door["album"]["albumhash"] for door in body["doors"]]


def test_there_are_no_doors_outside_december(calendar, monkeypatch):
    for today in (date(2026, 11, 30), date(2026, 12, 25), date(2027, 1, 1)):
        set_day(monkeypatch, today)

        assert advent(calendar) == {"day": 0, "doors": []}


def test_the_doors_up_to_today_each_with_an_album(calendar):
    body = advent(calendar)

    assert body["day"] == 5
    assert [door["day"] for door in body["doors"]] == [1, 2, 3, 4, 5]
    hashes = door_hashes(body)
    assert len(set(hashes)) == 5
    assert set(hashes) <= set(ALBUMS)


def test_a_door_carries_its_album_as_a_home_card(calendar):
    album = advent(calendar)["doors"][0]["album"]

    assert album["title"].startswith("Album ")
    assert album["image"].endswith(f"?pathhash=ph-{album['albumhash']}")
    assert album["albumartists"][0]["name"].startswith("Artist ")
    # What the Home cards leave out is left out here too.
    assert "genres" not in album and "og_title" not in album


def test_the_doors_stay_the_same_for_the_rest_of_the_day(calendar):
    before = door_hashes(advent(calendar))

    # Playing today's album moves it out of the "never played" tier — and must
    # not move its door.
    scrobble(th(before[-1]), int(pendulum.now().timestamp()) - 60)

    assert door_hashes(advent(calendar)) == before


def test_past_doors_stay_when_the_next_day_opens(calendar, monkeypatch):
    before = door_hashes(advent(calendar))

    set_day(monkeypatch, date(2026, 12, 6))
    after = advent(calendar)

    assert after["day"] == 6
    assert door_hashes(after)[:5] == before
    assert len(set(door_hashes(after))) == 6


def test_an_album_not_heard_for_months_is_behind_the_first_door(calendar):
    # The user heard album adv07 over a year ago and nothing else: it is the
    # quiet album, the first door draws it.
    long_ago = int(pendulum.now().timestamp()) - 400 * DAY
    scrobble(th("adv07"), long_ago)

    assert door_hashes(advent(calendar))[0] == "adv07"


def test_an_album_heard_lately_is_no_door_while_others_are_left(calendar):
    yesterday = int(pendulum.now().timestamp()) - DAY
    scrobble(th("adv03"), yesterday)

    assert "adv03" not in door_hashes(advent(calendar))


def test_another_user_has_a_calendar_of_their_own(calendar):
    long_ago = int(pendulum.now().timestamp()) - 400 * DAY
    scrobble(th("adv07"), long_ago, userid=1)
    first = door_hashes(advent(calendar))

    calendar.userid = 2
    second = door_hashes(advent(calendar))

    # User 2 has heard nothing: album adv07 is "never played" for them, not the
    # quiet first door it is for user 1, and their order is their own.
    assert first[0] == "adv07"
    assert second != first
    assert advent(calendar)["day"] == 5


def test_an_empty_library_has_no_doors(calendar, monkeypatch):
    from aivinnet.store.albums import AlbumStore

    monkeypatch.setattr(AlbumStore, "albummap", {})

    assert advent(calendar) == {"day": 5, "doors": []}
