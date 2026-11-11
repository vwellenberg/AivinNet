"""Personal track ratings (#777) over the real request cycle, against real SQLite.

What these pin:

- set validates 1-5 (422 out of the body validation, and the table unchanged),
  an unknown track is a 404 that writes nothing, overwrite and clear work;
- one user never sees or changes another user's rating;
- a serialized track carries the CALLER's rating (`rating`), null when unrated;
- a retag / name cleanup carries ratings along (swap-safe, existing rating wins);
- backup -> restore puts ratings back under their owner;
- ratings and favourites stay separate tables with no coupling.

Exact status codes, as in the other suites: body validation runs before the view.
"""

from dataclasses import asdict
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy import delete, insert, select

NOW = int(datetime(2026, 6, 1, tzinfo=UTC).timestamp())
TRACK = "1234567890abcdef"
OTHER = "fedcba0987654321"
OLD = "0ld0ld0ld0ld0ld0"
NEW = "n3wn3wn3wn3wn3w0"


def _track(n: int, trackhash: str):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    return Track(
        id=n,
        album="Album",
        albumartists="Artist",
        albumhash=f"alb-{trackhash}",
        artists="Artist",
        bitrate=320,
        copyright="",
        date=NOW,
        disc=1,
        duration=200,
        filepath=f"/music/Artist/{trackhash}.flac",
        folder="/music/Artist",
        genres="Rock",
        last_mod=NOW,
        title=f"Title {n}",
        track=n,
        trackhash=trackhash,
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
        added=NOW,
    )


@pytest.fixture()
def library(monkeypatch):
    """The track store, holding TRACK and OTHER, set per test (the stores are not filled at boot)."""
    from aivinnet.store.tracks import TrackGroup, TrackStore

    groups = {h: TrackGroup([_track(n, h)]) for n, h in enumerate((TRACK, OTHER), start=1)}
    monkeypatch.setattr(TrackStore, "trackhashmap", groups)
    return groups


@pytest.fixture()
def two_users():
    """Users 1 and 2 must exist: rating rows reference `user.id`, and foreign keys are on."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import TrackRatingTable, UserTable

    with DbEngine.manager(commit=True) as session:
        for uid, name in ((1, "rater"), (2, "other-rater")):
            if not session.execute(select(UserTable.id).where(UserTable.id == uid)).first():
                session.execute(insert(UserTable).values(id=uid, username=name, password="x", roles=[], extra={}))

    yield

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(TrackRatingTable))


@pytest.fixture()
def ratings_api(api_client, monkeypatch, library, two_users):
    from aivinnet.api import ratings as ratings_module

    handle = api_client("aivinnet.api.ratings")
    monkeypatch.setattr(ratings_module, "get_current_userid", lambda: handle.userid)
    return handle


def _stored() -> dict[tuple[str, int], int]:
    """The table read straight from SQL: `(trackhash, userid) -> rating`."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import TrackRatingTable

    with DbEngine.manager() as session:
        rows = session.execute(
            select(TrackRatingTable.trackhash, TrackRatingTable.userid, TrackRatingTable.rating)
        ).all()
    return {(r.trackhash, r.userid): r.rating for r in rows}


# --- endpoints -------------------------------------------------------------


def test_setting_a_rating_stores_it_and_updates_the_track_in_ram(ratings_api, library):
    res = ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 4})

    assert res.status_code == 200
    assert _stored() == {(TRACK, 1): 4}
    assert library[TRACK].tracks[0].rating_of(1) == 4


@pytest.mark.parametrize("bad", [0, 6, -1])
def test_a_rating_outside_one_to_five_is_refused_and_writes_nothing(ratings_api, bad):
    res = ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": bad})

    assert res.status_code == 422
    assert _stored() == {}


def test_an_unknown_track_is_404_and_leaves_the_table_unchanged(ratings_api):
    res = ratings_api.post("/ratings/set", json={"trackhash": "0000000000000000", "rating": 3})

    assert res.status_code == 404
    assert _stored() == {}


def test_setting_again_overwrites_the_rating(ratings_api):
    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 2})
    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 5})

    assert _stored() == {(TRACK, 1): 5}


def test_clearing_removes_the_row_and_the_ram_value(ratings_api, library):
    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 3})

    res = ratings_api.post("/ratings/clear", json={"trackhash": TRACK})

    assert res.status_code == 200
    assert _stored() == {}
    assert library[TRACK].tracks[0].rating_of(1) is None


def test_clearing_an_unrated_track_is_a_no_op(ratings_api):
    res = ratings_api.post("/ratings/clear", json={"trackhash": TRACK})

    assert res.status_code == 200
    assert _stored() == {}


def test_one_user_never_sees_or_changes_another_users_rating(ratings_api, library):
    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 1})

    ratings_api.userid = 2
    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 5})
    assert ratings_api.get("/ratings").json == {"ratings": {TRACK: 5}}

    ratings_api.post("/ratings/clear", json={"trackhash": TRACK})
    assert _stored() == {(TRACK, 1): 1}

    ratings_api.userid = 1
    assert ratings_api.get("/ratings").json == {"ratings": {TRACK: 1}}


def test_list_and_single_read_return_the_callers_ratings(ratings_api):
    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 4})

    assert ratings_api.get("/ratings").json == {"ratings": {TRACK: 4}}
    assert ratings_api.get(f"/ratings/{TRACK}").json == {"rating": 4}
    assert ratings_api.get(f"/ratings/{OTHER}").json == {"rating": None}


# --- the serialized track carries the caller's rating -----------------------


def test_a_serialized_track_carries_the_callers_rating_and_no_internals(library, two_users):
    from aivinnet.serializers.track import serialize_track

    track = library[TRACK].tracks[0]
    track.set_rating(1, 4)

    as_user_1 = serialize_track(track, userid=1)
    as_user_2 = serialize_track(track, userid=2)

    assert as_user_1["rating"] == 4
    assert as_user_2["rating"] is None
    # The raw map stays on the server; the client reads `rating`.
    assert "rated_by" not in as_user_1


# --- retags and name cleanup carry ratings along -----------------------------


def _stored_count_for(trackhash: str) -> int:
    return sum(1 for h, _ in _stored() if h == trackhash)


def test_a_retag_moves_the_rating_to_the_new_hash(api_client, two_users):
    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib.reference_migration import migrate_track_references

    api_client("aivinnet.api.ratings")  # creates the tables
    TrackRatingTable.set_rating(OLD, 1, 4)

    migrate_track_references(OLD, NEW)

    assert _stored() == {(NEW, 1): 4}
    assert _stored_count_for(OLD) == 0


def test_a_batch_swap_exchanges_ratings_instead_of_merging_them(api_client, two_users):
    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib.reference_migration import migrate_track_references_many

    api_client("aivinnet.api.ratings")
    TrackRatingTable.set_rating(OLD, 1, 2)
    TrackRatingTable.set_rating(NEW, 1, 5)

    migrate_track_references_many({OLD: NEW, NEW: OLD})

    assert _stored() == {(NEW, 1): 2, (OLD, 1): 5}


def test_an_existing_rating_on_the_new_hash_wins_over_the_old_one(api_client, two_users):
    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib.reference_migration import migrate_track_references

    api_client("aivinnet.api.ratings")
    TrackRatingTable.set_rating(OLD, 1, 2)
    TrackRatingTable.set_rating(NEW, 1, 5)

    migrate_track_references(OLD, NEW)

    assert _stored() == {(NEW, 1): 5}


# --- backup and restore -----------------------------------------------------


def test_a_backup_round_trip_restores_ratings_under_their_owner(api_client, two_users):
    from aivinnet.api.backup_and_restore import RestoreBackup
    from aivinnet.db.userdata import TrackRatingTable

    api_client("aivinnet.api.ratings")
    TrackRatingTable.set_rating(TRACK, 1, 4)
    TrackRatingTable.set_rating(TRACK, 2, 1)
    payload = TrackRatingTable.everyone()

    TrackRatingTable.clear_rating(TRACK, 1)
    TrackRatingTable.clear_rating(TRACK, 2)
    assert _stored() == {}

    with patch("aivinnet.api.backup_and_restore.get_current_userid", return_value=1):
        report = RestoreBackup.restore_ratings(object.__new__(RestoreBackup), payload)

    assert report.restored == 2
    assert _stored() == {(TRACK, 1): 4, (TRACK, 2): 1}


def test_a_restore_keeps_an_existing_rating_of_the_same_user(api_client, two_users):
    from aivinnet.api.backup_and_restore import RestoreBackup
    from aivinnet.db.userdata import TrackRatingTable

    api_client("aivinnet.api.ratings")
    TrackRatingTable.set_rating(TRACK, 1, 5)
    payload = [{"userid": 1, "trackhash": TRACK, "rating": 2, "timestamp": NOW}]

    with patch("aivinnet.api.backup_and_restore.get_current_userid", return_value=1):
        report = RestoreBackup.restore_ratings(object.__new__(RestoreBackup), payload)

    assert report.skipped == 1
    assert _stored() == {(TRACK, 1): 5}


def test_a_rating_is_not_a_favourite(library):
    # Ratings and favourites are separate: rating a track never favourites it.
    track = library[TRACK].tracks[0]
    track.set_rating(1, 3)

    assert track.fav_userids == []
    assert asdict(track)["rated_by"] == {1: 3}
