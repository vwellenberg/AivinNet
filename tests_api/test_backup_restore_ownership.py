"""
Backup -> restore of playlists, scrobbles and collections, against real SQLite.

`/backup/create` is `@admin_required`, so it is an INSTANCE backup. Favorites
were widened to every user first (AivinNet-Client#513); the other three sections
kept reading only the calling admin's rows, and nobody noticed because the
response counts what it wrote, not what it left out. So a restore after a disk
loss brought user 2's favorites back — and none of the playlists, listening
history or collections they belong to (#527).

Three properties per section, and every one of them is INVISIBLE with a single
user in the table — which is exactly how they survived the first round of tests:

    the backup holds every user's rows
    a known owner keeps their rows on restore
    an unknown owner falls back to the restoring user

Plus the counters: a restore that discards rows used to `print` and still answer
"Restored successfully".

Real SQLite rather than mocks — the question is what ends up STORED, and under
whom.
"""

from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import delete, insert, select

from aivinnet.api.backup_and_restore import RestoreBackup, all_scrobbles
from aivinnet.db import create_all_tables
from aivinnet.db.engine import DbEngine
from aivinnet.db.userdata import CollectionTable, PlaylistTable, ScrobbleTable, UserTable

TRACK = "1234567890abcdef"
OTHER_TRACK = "fedcba0987654321"


@pytest.fixture()
def owners_db():
    """
    Real SQLite, real tables, TWO users, wiped on both sides.

    ⚠️ BOTH bindings of `get_current_userid` are patched. `from … import
    get_current_userid` copies the name into the importing module, so patching
    only `db.userdata` leaves `api.backup_and_restore` calling the real one —
    which raises outside a request context and returns its hardcoded fallback of
    1. Every assertion about "the restoring user" would then be checking a
    constant, and this module would stay green with the scoping removed.

    Same shape as `test_backup_restore_favorites.py`.
    """
    create_all_tables()

    with DbEngine.manager(commit=True) as session:
        for uid, name in ((1, "restore-user"), (2, "other-user")):
            exists = session.execute(select(UserTable.id).where(UserTable.id == uid)).first()
            if not exists:
                session.execute(insert(UserTable).values(id=uid, username=name, password="x", roles=[], extra={}))
        # Wipe on BOTH sides. Teardown alone leaves this module depending on
        # nothing else in the suite having written first, and the exact-equality
        # assertions below would fail for reasons unrelated to them.
        for table in (PlaylistTable, ScrobbleTable, CollectionTable):
            session.execute(delete(table))

    with (
        patch("aivinnet.db.userdata.get_current_userid", return_value=1) as db_userid,
        patch("aivinnet.api.backup_and_restore.get_current_userid", return_value=1) as api_userid,
    ):
        yield SimpleNamespace(
            set=lambda uid: (
                setattr(db_userid, "return_value", uid),
                setattr(api_userid, "return_value", uid),
            )
        )

    with DbEngine.manager(commit=True) as session:
        for table in (PlaylistTable, ScrobbleTable, CollectionTable):
            session.execute(delete(table))


def _restore(method: str, payload: list[dict]):
    """
    Drive one `restore_*` without touching the filesystem.

    `RestoreBackup.__init__` only reads a JSON file; the sections are
    independent, so the method under test is called unbound.
    """
    return getattr(RestoreBackup, method)(object.__new__(RestoreBackup), payload)


# ---------------------------------------------------------------------------
# Playlists
# ---------------------------------------------------------------------------


def _make_playlist(name: str):
    """Create a playlist the way `insert_playlist` does — owner from the actor."""
    PlaylistTable.add_one(
        {
            "image": None,
            "last_updated": "0",
            "name": name,
            "trackhashes": [],
            "settings": {"pinned": False},
        }
    )


def _playlist_rows() -> list[tuple[str, int]]:
    with DbEngine.manager() as session:
        return sorted(
            (row[0], row[1]) for row in session.execute(select(PlaylistTable.name, PlaylistTable.userid)).all()
        )


def _playlist_backup() -> list[dict]:
    """Exactly what `create_backup` writes for the playlists section."""
    dicts = []
    for entry in PlaylistTable.get_all(current_user=False):
        playlist = asdict(entry)
        for key in ["id", "_last_updated", "has_image", "images", "duration", "count", "pinned", "thumb"]:
            del playlist[key]
        dicts.append(playlist)
    return dicts


def test_the_backup_holds_every_users_playlists(owners_db):
    """
    The #527 hole itself: `PlaylistTable.get_all()` defaults to the current
    user, so user 2's playlists were in no backup at all — and they cannot make
    one themselves, `/backup/create` is admin-only.
    """
    _make_playlist("Mine")

    owners_db.set(2)
    _make_playlist("Theirs")
    owners_db.set(1)

    payload = _playlist_backup()

    assert sorted(entry["name"] for entry in payload) == ["Mine", "Theirs"]
    assert sorted(entry["userid"] for entry in payload) == [1, 2]


def test_a_known_owner_keeps_their_playlist(owners_db):
    """
    `add_one` used to overwrite `userid` with the caller unconditionally, so
    restoring an instance backup handed every playlist in it to the admin.
    """
    report = _restore("restore_playlists", [_playlist_dict("Theirs", userid=2)])

    assert _playlist_rows() == [("Theirs", 2)]
    assert report.restored == 1


def test_an_unknown_owner_falls_back_to_the_restoring_user(owners_db):
    """
    Cross-instance case: user 7 does not exist here. Keeping the id would hit
    the `user.id` foreign key and be swallowed, so the row lands with whoever is
    restoring.

    ⚠️ Restoring as user 2, not 1 — `get_current_userid`'s real fallback outside
    a request IS 1, so asserting 1 would pass with the patch missing.
    """
    owners_db.set(2)

    _restore("restore_playlists", [_playlist_dict("Orphan", userid=7)])

    assert _playlist_rows() == [("Orphan", 2)]


def test_another_users_playlist_name_does_not_block_mine(owners_db):
    """
    The dedup key is (owner, name). Comparing the name alone read the whole
    instance as "mine", so user 1 having a "Road trip" made user 2's
    unrestorable.
    """
    _make_playlist("Road trip")

    _restore("restore_playlists", [_playlist_dict("Road trip", userid=2)])

    assert _playlist_rows() == [("Road trip", 1), ("Road trip", 2)]


def test_my_own_playlist_is_still_skipped(owners_db):
    """The scoping must not turn the dedup off — restoring twice stays a no-op."""
    _make_playlist("Mine")
    payload = _playlist_backup()

    first = _restore("restore_playlists", payload)
    second = _restore("restore_playlists", payload)

    assert _playlist_rows() == [("Mine", 1)]
    assert (first.restored, first.skipped) == (0, 1)
    assert (second.restored, second.skipped) == (0, 1)


def test_a_backup_holding_the_same_playlist_twice_inserts_it_once(owners_db):
    """
    The `existing` set is updated as rows go in. Without that, a file listing a
    playlist twice (or restoring "all backups", where the same rows appear in
    several files) would insert it once per occurrence — the dedup only ever
    looked at what was in the database when the section STARTED.
    """
    report = _restore("restore_playlists", [_playlist_dict("Twice", userid=1), _playlist_dict("Twice", userid=1)])

    assert _playlist_rows() == [("Twice", 1)]
    assert (report.restored, report.skipped) == (1, 1)


def _playlist_dict(name: str, userid: int) -> dict:
    return {
        "name": name,
        "image": None,
        "last_updated": "0",
        "settings": {"pinned": False},
        "trackhashes": [],
        "extra": {},
        "userid": userid,
        "_score": 0,
    }


# ---------------------------------------------------------------------------
# Scrobbles
# ---------------------------------------------------------------------------


def _scrobble_rows() -> list[tuple[str, int, int]]:
    with DbEngine.manager() as session:
        return sorted(
            (row[0], row[1], row[2])
            for row in session.execute(
                select(ScrobbleTable.trackhash, ScrobbleTable.timestamp, ScrobbleTable.userid)
            ).all()
        )


def _scrobble_dict(trackhash: str, timestamp: int, userid: int) -> dict:
    return {
        "trackhash": trackhash,
        "duration": 200,
        "timestamp": timestamp,
        "source": "al:abc",
        "userid": userid,
        "extra": {},
    }


def test_the_backup_holds_every_users_scrobbles(owners_db):
    """
    `ScrobbleTable.get_all` filters on the current user and has no all-users
    mode, so `all_scrobbles()` walks the user table. Without it, user 2's whole
    listening history was missing from the file.
    """
    ScrobbleTable.add(_scrobble_dict(TRACK, 1700000000, userid=1))
    ScrobbleTable.add(_scrobble_dict(OTHER_TRACK, 1700000001, userid=2))

    payload = [asdict(entry) for entry in all_scrobbles()]

    assert sorted(entry["trackhash"] for entry in payload) == sorted([TRACK, OTHER_TRACK])
    assert sorted(entry["userid"] for entry in payload) == [1, 2]


def test_a_known_owner_keeps_their_scrobbles(owners_db):
    report = _restore("restore_scrobbles", [_scrobble_dict(TRACK, 1700000000, userid=2)])

    assert _scrobble_rows() == [(TRACK, 1700000000, 2)]
    assert report.restored == 1


def test_an_unknown_owner_scrobble_falls_back_to_the_restoring_user(owners_db):
    owners_db.set(2)

    _restore("restore_scrobbles", [_scrobble_dict(TRACK, 1700000000, userid=7)])

    assert _scrobble_rows() == [(TRACK, 1700000000, 2)]


def test_another_users_play_at_the_same_second_does_not_block_mine(owners_db):
    """
    The dedup key is (owner, trackhash, timestamp). Without the owner, two
    people listening to the same track in the same second collapsed into one
    row — and the survivor kept whichever owner happened to be there first.
    """
    ScrobbleTable.add(_scrobble_dict(TRACK, 1700000000, userid=1))

    _restore("restore_scrobbles", [_scrobble_dict(TRACK, 1700000000, userid=2)])

    assert _scrobble_rows() == [(TRACK, 1700000000, 1), (TRACK, 1700000000, 2)]


def test_my_own_scrobble_is_still_skipped(owners_db):
    ScrobbleTable.add(_scrobble_dict(TRACK, 1700000000, userid=1))

    report = _restore("restore_scrobbles", [_scrobble_dict(TRACK, 1700000000, userid=1)])

    assert _scrobble_rows() == [(TRACK, 1700000000, 1)]
    assert (report.restored, report.skipped) == (0, 1)


# ---------------------------------------------------------------------------
# Collections
#
# ⚠️ The table is called `page` in the database — `CollectionTable.__tablename__`
# was kept as-is when collections were renamed, so grepping for a `collection`
# table finds nothing.
# ---------------------------------------------------------------------------


def _collection_rows() -> list[tuple[str, int]]:
    with DbEngine.manager() as session:
        return sorted(
            (row[0], row[1]) for row in session.execute(select(CollectionTable.name, CollectionTable.userid)).all()
        )


def _collection_dict(name: str, userid: int) -> dict:
    return {"name": name, "userid": userid, "items": [], "extra": {"description": ""}}


def test_the_backup_holds_every_users_collections(owners_db):
    """
    `CollectionTable.get_all()` had no all-users mode at all — it filtered on
    the current user unconditionally, so the section was admin-only by
    construction.
    """
    CollectionTable.insert_one(_collection_dict("Mine", userid=1))
    CollectionTable.insert_one(_collection_dict("Theirs", userid=2))

    payload = list(CollectionTable.get_all(current_user=False))

    assert sorted(entry["name"] for entry in payload) == ["Mine", "Theirs"]
    assert sorted(entry["userid"] for entry in payload) == [1, 2]


def test_the_default_collection_read_is_still_personal(owners_db):
    """
    Widening the backup must not widen the homepage. `store/homepage.py` asks
    for the requesting user's collections and calls `get_all()` with no
    argument.
    """
    CollectionTable.insert_one(_collection_dict("Mine", userid=1))
    CollectionTable.insert_one(_collection_dict("Theirs", userid=2))

    assert [entry["name"] for entry in CollectionTable.get_all()] == ["Mine"]


def test_a_known_owner_keeps_their_collection(owners_db):
    report = _restore("restore_collections", [_collection_dict("Theirs", userid=2)])

    assert _collection_rows() == [("Theirs", 2)]
    assert report.restored == 1


def test_an_unknown_owner_collection_falls_back_to_the_restoring_user(owners_db):
    owners_db.set(2)

    _restore("restore_collections", [_collection_dict("Orphan", userid=7)])

    assert _collection_rows() == [("Orphan", 2)]


def test_another_users_collection_name_does_not_block_mine(owners_db):
    CollectionTable.insert_one(_collection_dict("Discoveries", userid=1))

    _restore("restore_collections", [_collection_dict("Discoveries", userid=2)])

    assert _collection_rows() == [("Discoveries", 1), ("Discoveries", 2)]


def test_my_own_collection_is_still_skipped(owners_db):
    CollectionTable.insert_one(_collection_dict("Mine", userid=1))

    report = _restore("restore_collections", [_collection_dict("Mine", userid=1)])

    assert _collection_rows() == [("Mine", 1)]
    assert (report.restored, report.skipped) == (0, 1)


# ---------------------------------------------------------------------------
# The counters
# ---------------------------------------------------------------------------


def test_a_row_the_database_rejects_is_counted_not_printed(owners_db, caplog):
    """
    The reason #513 and #527 stayed hidden: every `restore_*` swallowed its
    `IntegrityError` into a `print`, so a restore could drop everything it read
    and still answer "Restored successfully".

    Both halves are asserted. The COUNT is what reaches the API response; the
    LOG line is what makes it actionable — "discarded: 412" on its own tells
    nobody which rows to recover, which is the trap of replacing a print with a
    bare counter.

    A NULL name violates the column, and the resolver cannot rescue it the way
    it rescues an unknown owner — so it is the honest way to produce a discard.
    """
    with caplog.at_level("ERROR", logger="aivinnet.api.backup_and_restore"):
        report = _restore("restore_collections", [{**_collection_dict("ok", userid=1), "name": None}])

    assert (report.restored, report.skipped, report.discarded) == (0, 0, 1)
    assert _collection_rows() == []
    assert any("collection" in record.getMessage() for record in caplog.records)
