"""
`GET /nothome/` with the rows "Because you listened to …", "On repeat" and
"Never played" (#138).

Real request cycle, real SQLite scrobbles, real routines; only the RAM library
stores are filled by hand (the app fills them at boot). The tracks are built
through `Track`, so artist and genre hashes are the ones the scanner makes.
"""

import pendulum
import pytest

DAY = 86400

ALBUMS = {
    # albumhash: (title, album artist, genre)
    "a0000000000000rh": ("Blood Sugar", "Red Hot Chili Peppers", "Funk Rock"),
    "a0000000000000fn": ("The Real Thing", "Faith No More", "Funk Rock"),
    "a0000000000000pr": ("Frizzle Fry", "Primus", "Funk Rock"),
    "a0000000000000mi": ("Kind of Blue", "Miles Davis", "Jazz"),
    # Untagged files: never played, but nothing to recommend.
    "a0000000000000un": ("Untagged", "Unknown", ""),
    # A second unplayed Funk Rock album: with Primus it makes a genre chip.
    "a0000000000000fi": ("Truth and Soul", "Fishbone", "Funk Rock"),
}
RHCP, FNM, PRIMUS, MILES, UNTAGGED, FISHBONE = ALBUMS

TRACKS: dict[tuple[str, int], object] = {}


def _track(albumhash: str, n: int):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    title, artist, genre = ALBUMS[albumhash]
    return Track(
        id=n,
        album=title,
        albumartists=artist,
        albumhash=albumhash,
        artists=artist,
        bitrate=320,
        copyright="",
        date=0,
        disc=1,
        duration=200,
        filepath=f"/music/{title}/{n:02}.flac",
        folder=f"/music/{title}",
        genres=genre,
        last_mod=0,
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
        # As the scanner stores it (`tagger.py`): ONE space-joined string. A
        # list here hid that the routine split it into characters.
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


def artisthash(albumhash: str) -> str:
    return TRACKS[(albumhash, 1)].albumartists[0]["artisthash"]


@pytest.fixture()
def home(api_client, monkeypatch):
    import aivinnet.store.homepage as homepage
    from aivinnet.store.albums import AlbumMapEntry, AlbumStore
    from aivinnet.store.artists import ArtistMapEntry, ArtistStore
    from aivinnet.store.homepage import HomepageStore
    from aivinnet.store.homepageentries import PersonalTitleEntry
    from aivinnet.store.tracks import TrackGroup, TrackStore

    TRACKS.clear()
    for albumhash in ALBUMS:
        for n in range(1, 6):
            TRACKS[(albumhash, n)] = _track(albumhash, n)

    albummap, artistmap = {}, {}
    for albumhash in ALBUMS:
        tracks = [t for (a, _), t in TRACKS.items() if a == albumhash]
        albummap[albumhash] = AlbumMapEntry(_album(albumhash, tracks), {t.trackhash for t in tracks})
        artist = tracks[0].albumartists[0]
        artistmap[artist["artisthash"]] = ArtistMapEntry(_artist(artist), {albumhash}, set())

    monkeypatch.setattr(AlbumStore, "albummap", albummap)
    monkeypatch.setattr(ArtistStore, "artistmap", artistmap)
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in TRACKS.values()})

    for entry in HomepageStore.entries.values():
        monkeypatch.setattr(entry, "items", {})
        monkeypatch.setattr(entry, "title", entry.title)
        if isinstance(entry, PersonalTitleEntry):
            monkeypatch.setattr(entry, "meta", {})
        for attr in ("chips", "trackhashes"):
            if hasattr(entry, attr):
                monkeypatch.setattr(entry, attr, {})

    api = api_client("aivinnet.api.home", "aivinnet.api.playlist")
    monkeypatch.setattr(homepage, "get_current_userid", lambda: api.userid)
    return api


def scrobble(trackhash: str, timestamp: int, userid: int = 1):
    from aivinnet.db.userdata import ScrobbleTable

    ScrobbleTable.add({"trackhash": trackhash, "timestamp": timestamp, "duration": 200, "source": "", "userid": userid})


def listen(start: int, *trackhashes: str, userid: int = 1):
    """One listening session: the tracks back to back."""
    for i, trackhash in enumerate(trackhashes):
        scrobble(trackhash, start + i * 200, userid)


def run_routines():
    from aivinnet.lib.recipes.homerows import BecauseYouListened, NeverPlayed, OnRepeat

    BecauseYouListened()
    OnRepeat()
    NeverPlayed()


def rows(api):
    res = api.get("/nothome/?limit=9")
    assert res.status_code == 200, res.text
    body = res.get_json()
    return {k: v for row in body for k, v in row.items()}, [k for row in body for k in row]


@pytest.fixture()
def history():
    """
    User 1: Red Hot Chili Peppers all over this week (one track four times),
    together with Faith No More in two sessions a month ago, and a long Faith
    No More history before that. Primus and Miles Davis were never played.
    """
    now = int(pendulum.now().timestamp())

    listen(now - DAY, th(RHCP, 1), th(RHCP, 2), th(RHCP, 3))
    for hours in (30, 50, 70):
        scrobble(th(RHCP, 1), now - hours * 3600)

    listen(now - 40 * DAY, th(RHCP, 4), th(FNM, 1), th(FNM, 2))
    listen(now - 30 * DAY, th(FNM, 3), th(RHCP, 5))

    for i in range(50):
        scrobble(th(FNM, 1 + i % 5), now - (100 + i) * DAY)

    return now


def test_the_three_rows_their_shape_and_order(home, history):
    run_routines()
    data, order = rows(home)

    assert order == ["because_you_listened", "on_repeat", "never_played"]

    because = data["because_you_listened"]
    assert because["title"] == "Because you listened to Red Hot Chili Peppers"
    assert because["url"] == f"/artists/{artisthash(RHCP)}"
    assert because["description"] == "Often played in the same sessions"
    (album,) = because["items"]
    assert album["type"] == "album"
    assert album["item"]["albumhash"] == FNM
    assert album["item"]["help_text"] == "2 sessions together"
    assert album["item"]["image"] == f"{FNM}.webp?pathhash=ph-The Real Thing"

    (track,) = data["on_repeat"]["items"]
    assert track["type"] == "track"
    assert track["item"]["trackhash"] == th(RHCP, 1)
    assert track["item"]["help_text"] == "4 plays this week"
    assert track["item"]["time"] == "not in the 8 weeks before"
    # The card's bars: nothing in the 8 weeks before, 4 this week; no average, no factor.
    assert track["item"]["home"] == {"weeks": [0] * 8 + [4], "factor": None}

    never = data["never_played"]["items"]
    ids = [i["item"]["albumhash"] for i in never]
    # Primus and Fishbone share a genre with what the user plays; Miles Davis
    # nothing; the untagged album is left out.
    assert set(ids[:2]) == {PRIMUS, FISHBONE} and ids[2:] == [MILES]
    assert never[0]["item"]["help_text"] == "funk rock"
    assert never[0]["item"]["time"] == "never played"
    assert never[2]["item"]["help_text"] == "never played"

    (chip,) = data["never_played"]["chips"]
    assert chip["label"] == "funk rock"
    assert {i["item"]["albumhash"] for i in chip["items"]} == {PRIMUS, FISHBONE}


def test_another_user_sees_none_of_it(home, history):
    run_routines()
    home.userid = 2

    _, order = rows(home)
    assert order == []


def test_the_title_falls_back_while_a_user_has_no_seed(home):
    from aivinnet.store.homepage import HomepageStore

    entry = HomepageStore.entries["because_you_listened"]
    entry.items[1] = [{"type": "album", "hash": FNM, "help_text": "2 sessions together"}]

    data, _ = rows(home)
    assert data["because_you_listened"]["title"] == "Because you listened"
    assert "url" not in data["because_you_listened"]


def test_an_album_played_from_never_played_leaves_it(home, history):
    run_routines()
    scrobble(th(PRIMUS, 2), history - 60)
    run_routines()

    data, _ = rows(home)
    assert [i["item"]["albumhash"] for i in data["never_played"]["items"]] == [FISHBONE, MILES]
    # One unplayed Funk Rock album left: no choice, no chip.
    assert "chips" not in data["never_played"]


def test_a_user_who_loses_the_seed_loses_the_title_too(home, history, monkeypatch):
    from aivinnet.store.homepage import HomepageStore

    run_routines()
    entry = HomepageStore.entries["because_you_listened"]
    assert entry.meta[1]["title"] == "Because you listened to Red Hot Chili Peppers"

    # A month and a half later nothing was played: no seed any more.
    later = pendulum.now().add(days=45)
    monkeypatch.setattr(pendulum, "now", lambda *a, **kw: later)
    run_routines()

    assert entry.items[1] == []
    assert 1 not in entry.meta


def run_newer_routines():
    from aivinnet.lib.recipes.homerows import ArtistsYouMightLike, ForgottenFavorites, ForThisTime

    ForThisTime()
    ArtistsYouMightLike()
    ForgottenFavorites()


def test_artists_you_might_like_come_from_the_users_playlists(home, history):
    from sqlalchemy import insert

    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import PlaylistTable

    # Next to Red Hot Chili Peppers (played most lately): Faith No More, known
    # well (50+ plays), and Primus and Miles Davis, never played.
    trackhashes = [th(RHCP, 1), th(FNM, 1), th(PRIMUS, 1), th(MILES, 2)]
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                id=3, name="Mixtape", last_updated=0, image=None, userid=1, settings={}, trackhashes=trackhashes
            )
        )

    run_newer_routines()
    data, order = rows(home)

    row = data["artists_you_might_like"]
    assert row["title"] == "Artists you might like"
    assert {i["item"]["artisthash"] for i in row["items"]} == {artisthash(PRIMUS), artisthash(MILES)}
    assert all(i["type"] == "artist" for i in row["items"])
    assert row["items"][0]["item"]["help_text"] == "in one of your playlists"
    assert row["items"][0]["item"]["time"] == "never played"

    home.userid = 2
    _, order = rows(home)
    assert "artists_you_might_like" not in order


def test_forgotten_favorites(home, history):
    # Faith No More 4: played ten times, last more than three months ago.
    # RHCP 1: played this week. Miles Davis 1: never played.
    for trackhash in (th(FNM, 4), th(RHCP, 1), th(MILES, 1)):
        TRACKS[next(k for k, t in TRACKS.items() if t.trackhash == trackhash)].fav_userids.append(1)

    run_newer_routines()
    data, _ = rows(home)

    items = data["forgotten_favorites"]["items"]
    assert [i["item"]["trackhash"] for i in items] == [th(FNM, 4), th(MILES, 1)]
    assert items[0]["item"]["help_text"].startswith("last ")
    assert items[0]["item"]["time"] == "10 plays"
    assert items[1]["item"]["help_text"] == "not played yet"

    home.userid = 2
    _, order = rows(home)
    assert "forgotten_favorites" not in order


def test_for_this_time_names_the_slot_and_finds_its_album(home, monkeypatch):
    wednesday_evening = pendulum.local(2026, 10, 7, 20, 30)
    monkeypatch.setattr(pendulum, "now", lambda *a, **kw: wednesday_evening)

    for week in range(1, 5):
        day = wednesday_evening.subtract(weeks=week)
        listen(int(day.replace(hour=20, minute=0).timestamp()), th(PRIMUS, 1))
        listen(int(day.replace(hour=8, minute=0).timestamp()), th(MILES, 1), th(MILES, 2))
        listen(int(day.replace(hour=20, minute=10).timestamp()), th(MILES, 3))

    run_newer_routines()
    data, _ = rows(home)

    row = data["for_this_time"]
    assert row["title"] == "Your weekday evenings"
    assert [i["item"]["albumhash"] for i in row["items"]] == [PRIMUS]
    assert row["items"][0]["item"]["help_text"] == "4 plays at this time"


def test_a_shutdown_stops_the_routines_between_users(home, history, monkeypatch):
    import threading

    from aivinnet import crons
    from aivinnet.store.homepage import HomepageStore

    stop = threading.Event()
    stop.set()
    monkeypatch.setattr(crons, "_stop", stop)

    run_routines()
    run_newer_routines()

    for key in (
        "because_you_listened",
        "on_repeat",
        "never_played",
        "for_this_time",
        "artists_you_might_like",
        "forgotten_favorites",
    ):
        assert HomepageStore.entries[key].items == {}, key


def test_on_repeat_is_also_a_playlist(home, history, monkeypatch):
    import aivinnet.lib.home.onrepeat as onrepeat

    monkeypatch.setattr(onrepeat, "get_current_userid", lambda: home.userid)
    run_routines()

    res = home.get("/playlists/onrepeat")
    assert res.status_code == 200, res.text
    body = res.get_json()
    assert body["info"]["name"] == "On repeat"
    assert [t["trackhash"] for t in body["tracks"]] == [th(RHCP, 1)]

    home.userid = 2
    assert home.get("/playlists/onrepeat").get_json()["tracks"] == []


def test_every_generated_playlist_is_known_by_name_too():
    """The registry and the name list must agree, see `generated_playlists`."""
    from aivinnet.lib.home.generated_playlists import GENERATED_PLAYLISTS
    from aivinnet.lib.home.homerows import CUSTOM_PLAYLISTS

    assert set(GENERATED_PLAYLISTS) == CUSTOM_PLAYLISTS


def test_on_this_day_shows_the_albums_of_several_years_and_plays_the_day(home, monkeypatch):
    import aivinnet.lib.home.onrepeat as onrepeat
    from aivinnet.db.userdata import ScrobbleTable
    from aivinnet.lib.recipes.homerows import OnThisDay

    monkeypatch.setattr(onrepeat, "get_current_userid", lambda: home.userid)

    def evening(years: int) -> int:
        return int(pendulum.now().subtract(years=years).start_of("day").add(hours=20).timestamp())

    # A year ago: one playlist session — Faith No More twice around one RHCP track.
    for i, trackhash in enumerate((th(FNM, 1), th(RHCP, 1), th(FNM, 2), th(FNM, 1))):
        ScrobbleTable.add(
            {"trackhash": trackhash, "timestamp": evening(1) + i * 200, "duration": 200, "source": "pl:7", "userid": 1}
        )
    # Two years ago: Primus, and Faith No More again (shown once, with its newest year).
    listen(evening(2), th(PRIMUS, 1), th(FNM, 3))

    OnThisDay()
    data, _ = rows(home)

    otd = data["on_this_day"]
    year = pendulum.now().year
    # Albums, not the one playlist the plays came from.
    assert [(i["item"]["albumhash"], i["item"]["help_text"]) for i in otd["items"]] == [
        (FNM, f"{year - 1} · 3 plays"),
        (RHCP, f"{year - 1} · 1 play"),
        (PRIMUS, f"{year - 2} · 1 play"),
    ]
    label = pendulum.now().subtract(years=1).format("D MMMM YYYY")
    assert otd["description"] == f"{label} · 13 min · mostly Faith No More · in the evening"

    # "Play that day": last year's day in the order heard, each track once.
    res = home.get("/playlists/onthisday")
    assert res.status_code == 200, res.text
    assert res.get_json()["info"]["name"] == f"On this day · {label}"
    assert [t["trackhash"] for t in res.get_json()["tracks"]] == [th(FNM, 1), th(RHCP, 1), th(FNM, 2)]

    home.userid = 2
    _, order = rows(home)
    assert "on_this_day" not in order
    assert home.get("/playlists/onthisday").get_json()["tracks"] == []


def test_on_this_day_plays_the_newest_year_still_in_the_library(home, monkeypatch):
    """A year whose tracks were all retagged away gives no summary and no playlist."""
    import aivinnet.lib.home.onrepeat as onrepeat
    from aivinnet.db.userdata import ScrobbleTable
    from aivinnet.lib.recipes.homerows import OnThisDay

    monkeypatch.setattr(onrepeat, "get_current_userid", lambda: home.userid)

    def evening(years: int) -> int:
        return int(pendulum.now().subtract(years=years).start_of("day").add(hours=20).timestamp())

    # Last year: only a hash the library no longer has (a retag changed it).
    ScrobbleTable.add({"trackhash": "0" * 16, "timestamp": evening(1), "duration": 200, "source": "", "userid": 1})
    listen(evening(2), th(PRIMUS, 1), th(PRIMUS, 2))

    OnThisDay()
    data, _ = rows(home)

    two_years = pendulum.now().subtract(years=2).format("D MMMM YYYY")
    assert data["on_this_day"]["description"].startswith(two_years + " · ")
    tracks = home.get("/playlists/onthisday").get_json()["tracks"]
    assert [t["trackhash"] for t in tracks] == [th(PRIMUS, 1), th(PRIMUS, 2)]
