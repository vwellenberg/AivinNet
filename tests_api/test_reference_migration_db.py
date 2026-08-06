"""The migrate_track_references TRANSACTION against a real database.

The three pure helpers (list replacement, added_at carry-over, favorite
decision) are fully unit-tested in tests/test_reference_migration.py — but the
DB loop that calls them was at 0 % in BOTH lanes, and per its own docstring the
original bug lived exactly in such a loop (list rewritten, parallel map
forgotten). This module drives the real function against real rows for two
users: playlists, favorites (per-user unique since AivinNet#87) and scrobbles.
"""

import pytest
from sqlalchemy import delete, insert, select

OLD = "0ld0ld0ld0ld0ld0"
NEW = "n3wn3wn3wn3wn3w0"
BYSTANDER = "bystander0000000"


@pytest.fixture()
def reference_db(playlist_db):
    """playlist_db plus favorites/scrobbles, all three wiped afterwards."""
    from swingmusic.db.engine import DbEngine
    from swingmusic.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    yield PlaylistTable, FavoritesTable, ScrobbleTable

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(FavoritesTable))
        session.execute(delete(ScrobbleTable))
        # playlist rows are wiped by playlist_db itself


def _insert_playlist(session, userid: int, name: str, trackhashes: list[str], extra: dict | None = None):
    from swingmusic.db.userdata import PlaylistTable

    session.execute(
        insert(PlaylistTable).values(
            name=name,
            last_updated=0,
            image=None,
            userid=userid,
            settings={},
            trackhashes=trackhashes,
            extra=extra or {},
        )
    )


def _insert_favorite(session, userid: int, trackhash: str):
    from swingmusic.db.userdata import FavoritesTable

    session.execute(
        insert(FavoritesTable).values(
            hash=f"track_{trackhash}",
            type="track",
            timestamp=1000,
            userid=userid,
            extra={},
        )
    )


def _insert_scrobble(session, userid: int, trackhash: str):
    from swingmusic.db.userdata import ScrobbleTable

    session.execute(
        insert(ScrobbleTable).values(
            trackhash=trackhash,
            duration=180,
            timestamp=1000,
            source="al:someal",
            userid=userid,
            extra={},
        )
    )


def _playlists_by_name(session):
    from swingmusic.db.userdata import PlaylistTable

    rows = session.execute(select(PlaylistTable.name, PlaylistTable.trackhashes, PlaylistTable.extra)).all()
    return {name: (trackhashes, extra) for name, trackhashes, extra in rows}


def test_playlists_of_all_users_are_rewritten_and_added_at_follows(reference_db):
    from swingmusic.db.engine import DbEngine
    from swingmusic.lib.reference_migration import migrate_track_references

    with DbEngine.manager(commit=True) as session:
        _insert_playlist(session, 1, "mine", [BYSTANDER, OLD], extra={"added_at": {OLD: 42, BYSTANDER: 7}})
        _insert_playlist(session, 2, "theirs", [OLD], extra={"added_at": {OLD: 99}})
        _insert_playlist(session, 1, "untouched", [BYSTANDER], extra={"added_at": {BYSTANDER: 7}})

    migrate_track_references(OLD, NEW)

    with DbEngine.manager() as session:
        playlists = _playlists_by_name(session)

    assert playlists["mine"][0] == [BYSTANDER, NEW]
    assert playlists["mine"][1]["added_at"] == {NEW: 42, BYSTANDER: 7}
    # Not just the current user: user 2's playlist moves too.
    assert playlists["theirs"][0] == [NEW]
    assert playlists["theirs"][1]["added_at"] == {NEW: 99}
    assert playlists["untouched"][0] == [BYSTANDER]
    assert playlists["untouched"][1]["added_at"] == {BYSTANDER: 7}


def test_a_playlist_holding_both_identities_collapses_to_one_entry(reference_db):
    from swingmusic.db.engine import DbEngine
    from swingmusic.lib.reference_migration import migrate_track_references

    with DbEngine.manager(commit=True) as session:
        _insert_playlist(
            session, 1, "both", [OLD, BYSTANDER, NEW], extra={"added_at": {OLD: 100, NEW: 50, BYSTANDER: 7}}
        )

    migrate_track_references(OLD, NEW)

    with DbEngine.manager() as session:
        trackhashes, extra = _playlists_by_name(session)["both"]

    assert trackhashes == [NEW, BYSTANDER]
    # The earlier of the two dates survives: that is when the track first landed.
    assert extra["added_at"] == {NEW: 50, BYSTANDER: 7}


def test_favorites_are_decided_per_user(reference_db):
    """User 1 only holds the old identity (rename); user 2 holds both (drop the
    old row). Neither decision may touch the other user's rows — under the old
    global UNIQUE(hash) a blanket UPDATE crashed on exactly this layout."""
    from swingmusic.db.engine import DbEngine
    from swingmusic.db.userdata import FavoritesTable
    from swingmusic.lib.reference_migration import migrate_track_references

    with DbEngine.manager(commit=True) as session:
        _insert_favorite(session, 1, OLD)
        _insert_favorite(session, 2, OLD)
        _insert_favorite(session, 2, NEW)

    migrate_track_references(OLD, NEW)

    with DbEngine.manager() as session:
        rows = session.execute(select(FavoritesTable.userid, FavoritesTable.hash)).all()

    assert sorted(rows) == [(1, f"track_{NEW}"), (2, f"track_{NEW}")]


def test_scrobbles_move_and_bystanders_stay(reference_db):
    from swingmusic.db.engine import DbEngine
    from swingmusic.db.userdata import ScrobbleTable
    from swingmusic.lib.reference_migration import migrate_track_references

    with DbEngine.manager(commit=True) as session:
        _insert_scrobble(session, 1, OLD)
        _insert_scrobble(session, 2, OLD)
        _insert_scrobble(session, 1, BYSTANDER)

    migrate_track_references(OLD, NEW)

    with DbEngine.manager() as session:
        hashes = sorted(row.trackhash for row in session.execute(select(ScrobbleTable.trackhash)).all())

    assert hashes == sorted([NEW, NEW, BYSTANDER])


@pytest.mark.parametrize(
    ("old", "new"),
    [("", NEW), (OLD, ""), (OLD, OLD)],
    ids=["empty-old", "empty-new", "same-hash"],
)
def test_degenerate_inputs_change_nothing(reference_db, old, new):
    from swingmusic.db.engine import DbEngine
    from swingmusic.db.userdata import FavoritesTable
    from swingmusic.lib.reference_migration import migrate_track_references

    with DbEngine.manager(commit=True) as session:
        _insert_playlist(session, 1, "mine", [OLD], extra={"added_at": {OLD: 42}})
        _insert_favorite(session, 1, OLD)

    migrate_track_references(old, new)

    with DbEngine.manager() as session:
        trackhashes, extra = _playlists_by_name(session)["mine"]
        favs = [row.hash for row in session.execute(select(FavoritesTable.hash)).all()]

    assert trackhashes == [OLD]
    assert extra["added_at"] == {OLD: 42}
    assert favs == [f"track_{OLD}"]
