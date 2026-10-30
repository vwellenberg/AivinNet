"""Smart playlists over the real request cycle, against a real SQLite database.

The library is a real `TrackStore` (realistic `Track` objects, year tags as
UTC timestamps, a track without a year tag, favourites), and the plays are real
`scrobble` rows, one user's own at a time. The stores are not filled at boot
here, so each test sets `TrackStore.trackhashmap` itself.

What these pin, beyond the rules themselves (`tests/test_smart_playlists.py`):

- a bad definition is a 400 and writes nothing;
- one user never sees, changes, deletes or freezes another user's smart playlist,
  and a play-based rule counts the CALLER's plays;
- "save as playlist" freezes what the rules hold now, and afterwards a
  library change does not reach it;
- there is no way to add, remove or move a track in a smart playlist.

Exact status codes: flask_openapi3 validates the body before the view runs, so
"not 200" would also pass against a view that never ran.
"""

import time
from datetime import UTC, datetime

import pytest

from aivinnet.lib import smart_playlist_tracks

NOW = int(time.time())
DAY = 86_400

# (trackhash, title, artist, genre, year or None, added this many days ago, favourited by)
LIBRARY_SPEC = [
    ("jerry", "Jerry Was a Race Car Driver", "Primus", "Rock", 1991, 5, [1]),
    ("mary", "Mary the Ostrich", "Primus", "Rock", 1995, 90, []),
    ("blue", "Blue Note", "Miles Davis", "Jazz", 1959, 300, []),
    ("clown", "The Clown", "Primus", "Rock", None, 200, []),  # no year tag
    ("mood", "Mood Indigo", "Duke Ellington", "Jazz", 1931, 2, []),
]

ALL = {"jerry", "mary", "blue", "clown", "mood"}


def _release(year: int) -> int:
    return int(datetime(year, 1, 1, tzinfo=UTC).timestamp())


def _track(n: int, spec: tuple):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    trackhash, title, artist, genre, year, added_days, favorites = spec
    last_mod = NOW - 1000 * DAY
    return Track(
        id=n,
        album=f"{title} (Album)",
        albumartists=artist,
        albumhash=f"alb-{trackhash}",
        artists=artist,
        bitrate=320,
        copyright="",
        # A year tag is a release date; without one the scanner keeps the mtime,
        # which the rules must not read as a year.
        date=_release(year) if year else last_mod,
        disc=1,
        duration=200,
        filepath=f"/music/{artist}/{title}.flac",
        folder=f"/music/{artist}",
        genres=genre,
        last_mod=last_mod,
        title=title,
        track=n,
        trackhash=trackhash,
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
        added=NOW - added_days * DAY,
        fav_userids=list(favorites),
    )


NEW_ROCK = ("newrock", "New Rock", "Primus", "Rock", 2020, 1, [])


def _hash(name: str) -> str:
    """The trackhash the tags give a track: the store and the scrobbles are keyed by it, as in the app."""
    spec = next(s for s in [*LIBRARY_SPEC, NEW_ROCK] if s[0] == name)
    return _track(0, spec).trackhash


def _names(hashes) -> list[str]:
    by_hash = {_hash(spec[0]): spec[0] for spec in LIBRARY_SPEC}
    return [by_hash.get(h, h) for h in hashes]


@pytest.fixture()
def library(monkeypatch):
    """The store, filled with LIBRARY_SPEC. Returns a setter for extra tracks."""
    from aivinnet.store.tracks import TrackGroup, TrackStore

    groups: dict[str, TrackGroup] = {}

    def add(spec: tuple, n: int) -> None:
        track = _track(n, spec)
        groups[track.trackhash] = TrackGroup([track])

    for n, spec in enumerate(LIBRARY_SPEC, start=1):
        add(spec, n)

    monkeypatch.setattr(TrackStore, "trackhashmap", groups)
    # The stores' generation counter is not read by the rules; nothing to bump.
    return add


@pytest.fixture(autouse=True)
def fresh_plays_cache():
    # Each test wipes the scrobble table, and the cache is keyed on the row
    # count and highest id: a later test could reuse an earlier key.
    smart_playlist_tracks._plays_cache.clear()
    yield
    smart_playlist_tracks._plays_cache.clear()


@pytest.fixture()
def smart(api_client, monkeypatch):
    """The blueprint, acting as user 1 — and the plays the rules count."""
    from aivinnet.api import smartplaylists as smart_api
    from aivinnet.db.userdata import ScrobbleTable

    handle = api_client("aivinnet.api.smartplaylists")
    monkeypatch.setattr(smart_api, "get_current_userid", lambda: handle.userid)

    ScrobbleTable.insert_many(
        [
            # user 1: jerry three times (yesterday), blue once two months ago
            {
                "trackhash": _hash("jerry"),
                "duration": 200,
                "timestamp": NOW - DAY,
                "source": "al:x",
                "userid": 1,
                "extra": {},
            },
            {
                "trackhash": _hash("jerry"),
                "duration": 200,
                "timestamp": NOW - DAY - 60,
                "source": "al:x",
                "userid": 1,
                "extra": {},
            },
            {
                "trackhash": _hash("jerry"),
                "duration": 200,
                "timestamp": NOW - DAY - 120,
                "source": "al:x",
                "userid": 1,
                "extra": {},
            },
            {
                "trackhash": _hash("blue"),
                "duration": 200,
                "timestamp": NOW - 60 * DAY,
                "source": "al:y",
                "userid": 1,
                "extra": {},
            },
            # user 2: blue five times, two days ago; jerry never
            *[
                {
                    "trackhash": _hash("blue"),
                    "duration": 200,
                    "timestamp": NOW - 2 * DAY + i,
                    "source": "al:y",
                    "userid": 2,
                    "extra": {},
                }
                for i in range(5)
            ],
        ]
    )
    return handle


def _rule(field: str, op: str, value=None) -> dict:
    return {"field": field, "op": op, "value": value}


def _body(name: str, *rules: dict, **extra) -> dict:
    return {"name": name, "match": extra.pop("match", "all"), "rules": list(rules), **extra}


def _create(smart, name: str = "Rock", *rules: dict, **extra):
    rules = rules or (_rule("genre", "is", "rock"),)
    return smart.post("/smartplaylists/new", json=_body(name, *rules, **extra))


def _stored_names(userid: int) -> list[str]:
    from aivinnet.db.userdata import SmartPlaylistTable

    return [row["name"] for row in SmartPlaylistTable.list_of(userid)]


def _titles(response) -> set[str]:
    return {track["title"] for track in response.get_json()["tracks"]}


def _hashes(response) -> list[str]:
    return _names(track["trackhash"] for track in response.get_json()["tracks"])


# ------------------------------------------------------------------ create


class TestCreate:
    def test_creates_one_and_returns_its_canonical_definition(self, smart):
        response = smart.post(
            "/smartplaylists/new",
            json=_body(
                "Rock 90s",
                _rule("genre", "is", "Rock"),
                _rule("year", "between", [1990, 1999]),
                limit=50,
                sort={"field": "year", "order": "asc"},
            ),
        )

        assert response.status_code == 201
        playlist = response.get_json()["playlist"]
        assert playlist["name"] == "Rock 90s"
        assert playlist["match"] == "all"
        assert playlist["limit"] == 50
        assert playlist["sort"] == {"field": "year", "order": "asc"}
        assert playlist["rules"][1] == {"field": "year", "op": "between", "value": [1990, 1999]}
        assert _stored_names(1) == ["Rock 90s"]

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            (_body("Bad", _rule("mood", "is", "x")), "unknown field 'mood'"),
            (_body("Bad", _rule("genre", "eq", "x")), "genre takes"),
            (_body("Bad", _rule("year", "between", [2000, 1990])), "is above high"),
            (_body("Bad", _rule("last_played", "never", 3)), "takes no value"),
            (_body("Bad", _rule("favorite", "is", "yes")), "true or false"),
            (_body("Bad"), "at least one rule"),
            (_body("Bad", _rule("favorite", "is", True), limit=0), "from 1 to 1000"),
            (_body("Bad", _rule("favorite", "is", True), limit=5000), "from 1 to 1000"),
            (_body("Bad", _rule("favorite", "is", True), match="some"), "match must be"),
            (_body("Bad", _rule("favorite", "is", True), sort={"field": "mood", "order": "asc"}), "sort field"),
        ],
    )
    def test_a_bad_rule_is_400_and_writes_nothing(self, smart, body, message):
        response = smart.post("/smartplaylists/new", json=body)

        assert response.status_code == 400
        assert message in response.get_json()["error"]
        assert _stored_names(1) == []

    def test_an_empty_name_is_400(self, smart):
        response = _create(smart, "   ")

        assert response.status_code == 400
        assert _stored_names(1) == []

    def test_a_second_one_with_the_same_name_is_409_and_the_first_stays(self, smart):
        assert _create(smart, "Rock").status_code == 201

        response = _create(smart, "Rock", _rule("favorite", "is", True))

        assert response.status_code == 409
        assert _stored_names(1) == ["Rock"]

    def test_the_same_name_is_free_for_another_user(self, smart):
        assert _create(smart, "Rock").status_code == 201

        smart.userid = 2
        assert _create(smart, "Rock").status_code == 201

        assert _stored_names(1) == ["Rock"]
        assert _stored_names(2) == ["Rock"]


# -------------------------------------------------------------------- list


class TestList:
    def test_lists_only_the_callers_own(self, smart):
        _create(smart, "Mine")
        smart.userid = 2
        _create(smart, "Theirs")
        smart.userid = 1

        names = [p["name"] for p in smart.get("/smartplaylists").get_json()["data"]]

        assert names == ["Mine"]


# --------------------------------------------------------------------- get


class TestGet:
    def test_evaluates_the_rules_against_the_library_now(self, smart, library):
        _create(smart, "Primus", _rule("artist", "is", "primus"))

        response = smart.get("/smartplaylists/1")

        assert response.status_code == 200
        body = response.get_json()
        assert body["info"]["count"] == 3
        assert _titles(response) == {"Jerry Was a Race Car Driver", "Mary the Ostrich", "The Clown"}

    def test_a_favourite_rule_is_each_users_own(self, smart, library):
        _create(smart, "Favourites", _rule("favorite", "is", True))  # id 1, user 1
        smart.userid = 2
        _create(smart, "Favourites", _rule("favorite", "is", True))  # id 2, user 2

        assert _titles(smart.get("/smartplaylists/2")) == set()
        smart.userid = 1
        assert _titles(smart.get("/smartplaylists/1")) == {"Jerry Was a Race Car Driver"}

    def test_play_rules_count_the_callers_own_plays(self, smart, library):
        _create(smart, "Played", _rule("playcount", "gt", 0))  # id 1, user 1
        smart.userid = 2
        _create(smart, "Played", _rule("playcount", "gt", 0))  # id 2, user 2

        # user 1 played jerry and blue, user 2 only blue: the same rule, two answers.
        assert _titles(smart.get("/smartplaylists/2")) == {"Blue Note"}
        smart.userid = 1
        assert _titles(smart.get("/smartplaylists/1")) == {"Jerry Was a Race Car Driver", "Blue Note"}

    def test_never_played_is_the_callers_view_too(self, smart, library):
        _create(smart, "Unheard", _rule("last_played", "never"))

        assert _titles(smart.get("/smartplaylists/1")) == {"Mary the Ostrich", "The Clown", "Mood Indigo"}

    def test_recently_played_and_recently_added(self, smart, library):
        _create(smart, "Recent", _rule("last_played", "in_last_days", 7))
        _create(smart, "New", _rule("date_added", "in_last_days", 10))

        assert _titles(smart.get("/smartplaylists/1")) == {"Jerry Was a Race Car Driver"}
        assert _titles(smart.get("/smartplaylists/2")) == {"Jerry Was a Race Car Driver", "Mood Indigo"}

    def test_pages_follow_start_and_limit_in_the_playlists_order(self, smart, library):
        _create(
            smart,
            "All",
            _rule("date_added", "in_last_days", 10_000),
            sort={"field": "date_added", "order": "asc"},
        )

        pages = [_hashes(smart.get(f"/smartplaylists/1?start={start}&limit=2")) for start in (0, 2, 4)]

        # Oldest added first: blue (300 days), clown (200), mary (90), jerry (5), mood (2).
        assert pages == [["blue", "clown"], ["mary", "jerry"], ["mood"]]
        assert smart.get("/smartplaylists/1?limit=2").get_json()["info"]["count"] == 5

    def test_limit_minus_one_is_all_the_rest(self, smart, library):
        _create(smart, "All", _rule("date_added", "in_last_days", 10_000))

        tracks = smart.get("/smartplaylists/1?limit=-1").get_json()["tracks"]

        assert set(_names(t["trackhash"] for t in tracks)) == ALL

    def test_a_random_order_is_one_order_across_pages(self, smart, library):
        _create(smart, "Shuffled", _rule("date_added", "in_last_days", 10_000), sort="random")

        first = _hashes(smart.get("/smartplaylists/1?start=0&limit=3"))
        second = _hashes(smart.get("/smartplaylists/1?start=3&limit=3"))

        assert len(first) == 3 and len(second) == 2
        assert set(first) | set(second) == ALL
        assert not set(first) & set(second)

    def test_another_users_smart_playlist_is_404(self, smart, library):
        _create(smart, "Mine")

        smart.userid = 2
        response = smart.get("/smartplaylists/1")

        assert response.status_code == 404
        assert response.get_json() == {"msg": "Playlist not found"}

    def test_a_missing_one_is_404(self, smart, library):
        assert smart.get("/smartplaylists/999").status_code == 404


# ------------------------------------------------------------------ update


class TestUpdate:
    def test_replaces_the_name_and_the_rules(self, smart, library):
        _create(smart, "Rock")

        response = smart.put(
            "/smartplaylists/1/update",
            json=_body("Primus only", _rule("artist", "is", "Primus"), sort={"field": "year", "order": "desc"}),
        )

        assert response.status_code == 200
        assert response.get_json()["playlist"]["name"] == "Primus only"
        assert _stored_names(1) == ["Primus only"]
        assert _titles(smart.get("/smartplaylists/1")) == {
            "Jerry Was a Race Car Driver",
            "Mary the Ostrich",
            "The Clown",
        }

    def test_a_bad_rule_is_400_and_the_old_rules_stay(self, smart, library):
        _create(smart, "Rock")

        response = smart.put("/smartplaylists/1/update", json=_body("Rock", _rule("mood", "is", "x")))

        assert response.status_code == 400
        assert _titles(smart.get("/smartplaylists/1")) == {
            "Jerry Was a Race Car Driver",
            "Mary the Ostrich",
            "The Clown",
        }

    def test_another_users_is_404_and_untouched(self, smart, library):
        _create(smart, "Rock")

        smart.userid = 2
        response = smart.put("/smartplaylists/1/update", json=_body("Hijacked", _rule("favorite", "is", True)))

        assert response.status_code == 404
        smart.userid = 1
        assert _stored_names(1) == ["Rock"]
        assert _stored_names(2) == []

    def test_renaming_onto_another_of_your_own_is_409(self, smart, library):
        _create(smart, "Rock")
        _create(smart, "Jazz", _rule("genre", "is", "Jazz"))

        response = smart.put("/smartplaylists/2/update", json=_body("Rock", _rule("genre", "is", "Jazz")))

        assert response.status_code == 409
        assert sorted(_stored_names(1)) == ["Jazz", "Rock"]


# ------------------------------------------------------------------ delete


class TestDelete:
    def test_deletes_your_own(self, smart, library):
        _create(smart, "Rock")

        response = smart.delete("/smartplaylists/1/delete")

        assert response.status_code == 200
        assert smart.get("/smartplaylists/1").status_code == 404
        assert _stored_names(1) == []

    def test_another_users_is_404_and_stays(self, smart, library):
        _create(smart, "Rock")

        smart.userid = 2
        response = smart.delete("/smartplaylists/1/delete")

        assert response.status_code == 404
        smart.userid = 1
        assert _stored_names(1) == ["Rock"]


# ------------------------------------------------------- save as playlist


def _normal_playlists(userid: int) -> list[str]:
    """Names of the normal playlists the given user owns (the table reads the current user)."""
    import aivinnet.db.userdata as userdata
    from aivinnet.db.userdata import PlaylistTable

    original = userdata.get_current_userid
    userdata.get_current_userid = lambda: userid
    try:
        return [p.name for p in PlaylistTable.get_all()]
    finally:
        userdata.get_current_userid = original


class TestSaveAsPlaylist:
    def test_freezes_what_the_rules_hold_now_in_their_order(self, smart, library):
        _create(smart, "Rock", _rule("genre", "is", "rock"), sort={"field": "date_added", "order": "asc"})
        shown = _hashes(smart.get("/smartplaylists/1"))

        response = smart.post("/smartplaylists/1/save-as-playlist", json={"name": "Frozen rock"})

        assert response.status_code == 201
        assert response.get_json()["playlist"]["count"] == 3
        assert shown == ["clown", "mary", "jerry"]

        from aivinnet.db.userdata import PlaylistTable

        frozen = next(p for p in PlaylistTable.get_all() if p.name == "Frozen rock")
        assert _names(frozen.trackhashes) == shown
        assert _normal_playlists(1) == ["Frozen rock"]

    def test_the_copy_does_not_follow_the_library(self, smart, library):
        _create(smart, "Rock", _rule("genre", "is", "rock"), sort={"field": "date_added", "order": "asc"})
        smart.post("/smartplaylists/1/save-as-playlist", json={"name": "Frozen rock"})

        library(NEW_ROCK, 99)

        assert len(_hashes(smart.get("/smartplaylists/1"))) == 4

        from aivinnet.db.userdata import PlaylistTable

        frozen = next(p for p in PlaylistTable.get_all() if p.name == "Frozen rock")
        assert _track(99, NEW_ROCK).trackhash not in frozen.trackhashes
        assert len(frozen.trackhashes) == 3

    def test_a_name_taken_by_a_normal_playlist_is_409_and_writes_nothing(self, smart, library):
        from aivinnet.db.userdata import PlaylistTable

        PlaylistTable.add_one({"name": "Taken", "userid": 1, "settings": {}, "last_updated": 0, "trackhashes": []})
        _create(smart, "Rock")

        response = smart.post("/smartplaylists/1/save-as-playlist", json={"name": "Taken"})

        assert response.status_code == 409
        assert _normal_playlists(1) == ["Taken"]

    def test_nothing_matching_is_400_and_writes_nothing(self, smart, library):
        _create(smart, "Polka", _rule("genre", "is", "Polka"))

        response = smart.post("/smartplaylists/1/save-as-playlist", json={"name": "Empty"})

        assert response.status_code == 400
        assert _normal_playlists(1) == []

    def test_another_users_smart_playlist_is_404_and_writes_nothing(self, smart, library):
        _create(smart, "Rock")

        smart.userid = 2
        response = smart.post("/smartplaylists/1/save-as-playlist", json={"name": "Stolen"})

        assert response.status_code == 404
        assert _normal_playlists(2) == []
        assert _normal_playlists(1) == []

    def test_a_blank_name_is_400_and_writes_nothing(self, smart, library):
        _create(smart, "Rock")

        response = smart.post("/smartplaylists/1/save-as-playlist", json={"name": "  "})

        assert response.status_code == 400
        assert _normal_playlists(1) == []


# ------------------------------------------------- no track editing at all


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/smartplaylists/1/add"),
        ("post", "/smartplaylists/1/remove-tracks"),
        ("put", "/smartplaylists/1/move-track"),
        ("put", "/smartplaylists/1/reorder"),
        ("post", "/smartplaylists/1/prune-orphans"),
    ],
)
def test_there_is_no_way_to_edit_the_tracks_of_a_smart_playlist(smart, library, method, path):
    _create(smart, "Rock")

    response = getattr(smart, method)(path, json={"trackhash": _hash("jerry"), "before_trackhash": "mary"})

    assert response.status_code == 404
