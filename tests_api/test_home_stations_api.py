"""
The radio's genre and decade stations (#640) through the real request cycle:
the routine (`lib/recipes/stations.py`) fills the store from real SQLite
scrobbles, then `GET /nothome/stations` lists them and `GET /playlists/<id>`
serves them like any playlist.

Only the RAM library stores are filled by hand (the app fills them at boot).
Tracks are built through `Track`, so genre hashes are the ones the scanner
makes; the release date is the tag's timestamp, and a track without a year
tag carries its file's mtime there (`taglib.py`), which the routine must not
read as a release.
"""

from collections import Counter
from datetime import UTC, datetime

import pendulum
import pytest

DAY = 86400
LAST_MOD = 1_700_000_000
# A file with no year tag: the scanner stored its mtime as the release date.
MTIME = 1_780_000_000

# album: (title, album artist, genre, release timestamp or None for no tag)
ALBUMS: dict[str, tuple[str, str, str, int | None]] = {
    **{
        f"r{n}": (f"Rock {n}", "Rock Band", "Rock", int(datetime(1994, 1, 1, tzinfo=UTC).timestamp())) for n in range(4)
    },
    **{f"j{n}": (f"Jazz {n}", "Jazz Trio", "Jazz", None) for n in range(3)},
}
TRACKS_PER_ALBUM = 8

TRACKS: dict[tuple[str, int], object] = {}


def _track(albumhash: str, n: int):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    title, artist, genre, release = ALBUMS[albumhash]
    return Track(
        id=n,
        album=title,
        albumartists=artist,
        albumhash=albumhash,
        artists=artist,
        bitrate=320,
        copyright="",
        date=release if release is not None else MTIME,
        disc=1,
        duration=200,
        filepath=f"/music/{title}/{n:02}.flac",
        folder=f"/music/{title}",
        genres=genre,
        last_mod=LAST_MOD if release is not None else MTIME,
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

    title = ALBUMS[albumhash][0]
    first = tracks[0]
    return Album(
        albumartists=first.albumartists,
        albumhash=albumhash,
        artisthashes=[a["artisthash"] for a in first.albumartists],
        base_title=title,
        color="",
        created_date=0,
        date=0,
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
        pathhash=f"ph-{title}",
    )


def _artist(albumartist: dict):
    from aivinnet.models.artist import Artist

    return Artist(
        name=albumartist["name"],
        albumcount=1,
        artisthash=albumartist["artisthash"],
        created_date=0,
        date=0,
        duration=0,
        genres=[],
        genrehashes=[],
        trackcount=5,
        lastplayed=0,
        playcount=0,
        playduration=0,
        extra={},
    )


def th(albumhash: str, n: int) -> str:
    return TRACKS[(albumhash, n)].trackhash


@pytest.fixture()
def radio(api_client, monkeypatch):
    import aivinnet.api.home as home_api
    import aivinnet.lib.first_play_cache as first_play_cache
    import aivinnet.lib.home.onrepeat as onrepeat
    from aivinnet.store.albums import AlbumMapEntry, AlbumStore
    from aivinnet.store.artists import ArtistMapEntry, ArtistStore
    from aivinnet.store.stations import StationStore
    from aivinnet.store.tracks import TrackGroup, TrackStore

    monkeypatch.setattr(first_play_cache, "_first_plays", {})

    TRACKS.clear()
    for albumhash in ALBUMS:
        for n in range(1, TRACKS_PER_ALBUM + 1):
            TRACKS[(albumhash, n)] = _track(albumhash, n)

    albummap, artistmap = {}, {}
    for albumhash in ALBUMS:
        tracks = [t for (a, _), t in TRACKS.items() if a == albumhash]
        albummap[albumhash] = AlbumMapEntry(_album(albumhash, tracks), {t.trackhash for t in tracks})
        artist = tracks[0].albumartists[0]
        artistmap[artist["artisthash"]] = ArtistMapEntry(_artist(artist), {albumhash}, {t.trackhash for t in tracks})

    monkeypatch.setattr(AlbumStore, "albummap", albummap)
    monkeypatch.setattr(ArtistStore, "artistmap", artistmap)
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in TRACKS.values()})
    monkeypatch.setattr(StationStore, "stations", {})

    api = api_client("aivinnet.api.home", "aivinnet.api.playlist")
    monkeypatch.setattr(home_api, "get_current_userid", lambda: api.userid)
    monkeypatch.setattr(onrepeat, "get_current_userid", lambda: api.userid)
    return api


def scrobble(trackhash: str, timestamp: int, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add({"trackhash": trackhash, "timestamp": timestamp, "duration": 200, "source": "", "userid": userid})


@pytest.fixture()
def history():
    """
    User 1 plays rock all over the last weeks (four albums, the first two most)
    and jazz three times. Jazz is tagged with no year: its tracks carry their
    file's mtime as the release date, and must not make a jazz decade.
    """
    now = int(pendulum.now().timestamp())
    for n, albumhash in enumerate(["r0", "r0", "r0", "r1", "r1", "r2", "r3"]):
        for k in range(1, 4):
            scrobble(th(albumhash, k), now - (n + 1) * DAY - k * 300)
    for k in range(3):
        scrobble(th("j0", k + 1), now - 2 * DAY - k * 300)
    return now


def run_routine():
    from aivinnet.lib.recipes.stations import RadioStations

    RadioStations()


def listing(radio):
    res = radio.get("/nothome/stations")
    assert res.status_code == 200, res.text
    return res.get_json()


def test_the_user_sees_genre_and_decade_stations_in_dial_order(radio, history):
    run_routine()

    stations = listing(radio)

    # Rock: the most played genre; jazz qualifies too (three plays). Only rock
    # has a decade: jazz has no release year, its mtime is no decade.
    assert stations == [
        {"id": "genre1", "kind": "genre", "name": "rock"},
        {"id": "genre2", "kind": "genre", "name": "jazz"},
        {"id": "decade1", "kind": "decade", "name": "1990s"},
    ]


def test_a_station_plays_as_a_generated_playlist(radio, history):
    run_routine()

    body = radio.get("/playlists/genre1").get_json()

    assert body["info"]["name"] == "rock"
    tracks = [t["trackhash"] for t in body["tracks"]]
    assert 8 <= len(tracks) <= 30
    assert len(tracks) == len(set(tracks))
    # Rock tracks only, at most three from any album.
    album = {t.trackhash: a for (a, _), t in TRACKS.items()}
    assert {album[t] for t in tracks} <= {"r0", "r1", "r2", "r3"}
    assert max(Counter(album[t] for t in tracks).values()) <= 3


def test_a_decade_station_plays_its_decade(radio, history):
    run_routine()

    body = radio.get("/playlists/decade1").get_json()

    assert body["info"]["name"] == "1990s"
    album = {t.trackhash: a for (a, _), t in TRACKS.items()}
    assert body["tracks"] and {album[t["trackhash"]] for t in body["tracks"]} <= {"r0", "r1", "r2", "r3"}


def test_an_empty_slot_is_an_empty_station_not_a_404(radio, history):
    run_routine()

    res = radio.get("/playlists/genre4")

    assert res.status_code == 200
    assert res.get_json()["tracks"] == []
    assert res.get_json()["info"]["name"] == "Genre 4"


def test_another_user_has_no_stations(radio, history):
    run_routine()
    radio.userid = 2

    assert listing(radio) == []
    assert radio.get("/playlists/genre1").get_json()["tracks"] == []


def test_no_history_in_the_window_means_no_stations(radio, history, monkeypatch):
    run_routine()
    assert listing(radio) != []

    # Half a year on, nothing was played in the window: the stations go, and a
    # slot still answers with its empty playlist rather than a 404.
    later = pendulum.now().add(days=200)
    monkeypatch.setattr(pendulum, "now", lambda *a, **kw: later)
    run_routine()

    assert listing(radio) == []
    assert radio.get("/playlists/genre1").get_json()["tracks"] == []
