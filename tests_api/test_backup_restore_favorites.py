"""
Backup -> restore of favorites, against a real SQLite database.

AivinNet-Client#451 reported that the restore doubles the type prefix
(`track_track_<hash>`), making restored favorites invisible. Reading
`FavoritesTable.insert_item` alone, that is exactly what it looks like: it
prefixes unconditionally, and the column stores prefixed hashes.

It does not happen, and the reason is one function away: `Favorite`'s
`__post_init__` STRIPS the prefix on the way out, so a backup contains raw
hashes and `insert_item` is the right call. The full round trip is

    insert_item      raw -> `<type>_<hash>` in the column
    get_all          column -> Favorite.__post_init__ -> raw again
    asdict           raw into the backup JSON
    restore          raw -> insert_item -> `<type>_<hash>` again

Every hop is correct, and no single file shows it. That is what these tests
pin down: not a fix, but the invariant, so the next reader gets an answer
from the suite instead of a plausible-looking wrong one.

Real SQLite rather than mocks — the question is what ends up STORED.
"""

from dataclasses import asdict
from unittest.mock import patch

import pytest
from sqlalchemy import delete, insert, select

from aivinnet.api.backup_and_restore import RestoreBackup
from aivinnet.db import create_all_tables
from aivinnet.db.engine import DbEngine
from aivinnet.db.userdata import FavoritesTable, UserTable

TRACK = "1234567890abcdef"
ALBUM = "fedcba0987654321"
ARTIST = "abcdef1234567890"


@pytest.fixture()
def favorites_db():
    """
    Real SQLite, real FavoritesTable, wiped between tests.

    Same shape as `test_favorites_table_roundtrip.py`: the users have to exist
    because `favorite.userid` is a foreign key and the engine runs with
    PRAGMA foreign_keys=ON. TWO of them — the scoping bugs (#513) are invisible
    with one, which is how they survived the first round of tests here.

    `get_current_userid` is patched rather than faked through a JWT (the
    subject is the table and the restore, not auth) but stays a parameter, so
    a test can switch identity mid-run.
    """
    create_all_tables()

    with DbEngine.manager(commit=True) as session:
        for uid, name in ((1, "restore-user"), (2, "other-user")):
            exists = session.execute(select(UserTable.id).where(UserTable.id == uid)).first()
            if not exists:
                session.execute(insert(UserTable).values(id=uid, username=name, password="x", roles=[], extra={}))
        # Wipe on BOTH sides. Teardown alone leaves the module depending on
        # nothing else in the suite having written favorites first, and the
        # exact-equality assertions below would then fail for a reason that has
        # nothing to do with them.
        session.execute(delete(FavoritesTable))

    with patch("aivinnet.db.userdata.get_current_userid", return_value=1) as userid:
        yield userid

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(FavoritesTable))


def _stored_hashes() -> list[str]:
    """The raw column, not the dataclass — the dataclass is what hides the prefix."""
    with DbEngine.manager() as session:
        return sorted(row[0] for row in session.execute(select(FavoritesTable.hash)).all())


def _favorite_everything():
    """Favorite one of each type the way `/favorites/add` does — with RAW hashes."""
    FavoritesTable.insert_item({"hash": TRACK, "type": "track"})
    FavoritesTable.insert_item({"hash": ALBUM, "type": "album"})
    FavoritesTable.insert_item({"hash": ARTIST, "type": "artist"})


def _backup_payload() -> list[dict]:
    """Exactly what `create_backup` writes: `asdict` over MY favorites (#513)."""
    return [asdict(entry) for entry in FavoritesTable.get_all(with_user=True)]


def _wipe():
    with DbEngine.manager(commit=True) as session:
        session.execute(delete(FavoritesTable))


def _restore(payload: list[dict]):
    """
    Drive `restore_favorites` without touching the filesystem.

    `RestoreBackup.__init__` reads a JSON file and restores four sections; only
    the favorites one is under test, so the method is called unbound.
    """
    RestoreBackup.restore_favorites(object.__new__(RestoreBackup), payload)


def test_the_column_carries_the_prefix(favorites_db):
    """Half one of the round trip, and the half that makes #451 look real."""
    _favorite_everything()

    assert _stored_hashes() == sorted([f"track_{TRACK}", f"album_{ALBUM}", f"artist_{ARTIST}"])


def test_the_backup_carries_the_raw_hash(favorites_db):
    """
    Half two, and the one nobody looks at: `Favorite.__post_init__` strips the
    prefix, so what reaches the backup JSON is raw. This is why feeding it back
    through the prefixing `insert_item` is correct rather than doubled.
    """
    _favorite_everything()

    hashes = sorted(entry["hash"] for entry in _backup_payload())

    assert hashes == sorted([TRACK, ALBUM, ARTIST])
    assert not any(h.startswith(("track_", "album_", "artist_")) for h in hashes)


def test_restore_writes_each_prefix_exactly_once(favorites_db):
    _favorite_everything()
    payload = _backup_payload()
    before = _stored_hashes()

    _wipe()
    _restore(payload)

    assert _stored_hashes() == before
    assert not any(h.startswith(("track_track_", "album_album_", "artist_artist_")) for h in _stored_hashes())


def test_restored_favorites_are_visible_again(favorites_db):
    """
    The assertion that matters to the user: `check_exists` is what
    `/favorites/check` and the heart in the client ask.

    ⚠️ On its own this one is too weak to guard the prefix — `check_exists`
    matches `hash == <raw>` OR `hash == <type>_<raw>`, so it stays green even
    if the column held an unprefixed hash. It is here for the user-visible
    outcome; `test_restore_writes_each_prefix_exactly_once` above is what
    actually pins the storage format.
    """
    _favorite_everything()
    payload = _backup_payload()

    _wipe()
    assert FavoritesTable.check_exists(TRACK, "track") is False

    _restore(payload)

    assert FavoritesTable.check_exists(TRACK, "track") is True
    assert FavoritesTable.check_exists(ALBUM, "album") is True
    assert FavoritesTable.check_exists(ARTIST, "artist") is True


def test_restore_over_a_live_library_does_not_duplicate(favorites_db):
    """
    The dedup check compares the backup's RAW hash against `fav.hash` from
    `get_all()` — also raw, for the same `__post_init__` reason. Both sides
    speak the same dialect, so an item that is still favorited is skipped.

    ⚠️ Asserting "still 3 rows" after restoring over a full table proves
    nothing: `insert_item`'s own `row_id` guard and the unique constraint hold
    that line even if the dedup comparison were broken. So this restores over a
    PARTIAL library — one row present, two missing — and checks that the
    survivor kept its identity while the other two came back.
    """
    _favorite_everything()
    payload = _backup_payload()

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(FavoritesTable).where(FavoritesTable.hash != f"track_{TRACK}"))
    assert _stored_hashes() == [f"track_{TRACK}"]

    _restore(payload)

    assert _stored_hashes() == sorted([f"track_{TRACK}", f"album_{ALBUM}", f"artist_{ARTIST}"])


def test_an_already_prefixed_hash_is_not_prefixed_twice(favorites_db):
    """
    `insert_item` is idempotent about the prefix.

    ⚠️ No caller passes a prefixed hash today, and no backup ever held one
    (62097456 added the prefixing and the strip in the same commit, so nothing
    was prefixed before it). This is defence in depth, not a regression test —
    it guards the one mistake this pair keeps inviting, and the reason that
    mistake is worth guarding is that it fails SILENTLY: `track_track_<hash>`
    satisfies every constraint and matches no lookup, so the write succeeds
    and the favorite is gone.

    #451 was filed on that theory, and the first attempt at "fixing" it went
    the other way and would have written unprefixed rows.
    """
    FavoritesTable.insert_item({"hash": f"track_{TRACK}", "type": "track"})

    assert _stored_hashes() == [f"track_{TRACK}"]
    assert FavoritesTable.check_exists(TRACK, "track") is True


# ---------------------------------------------------------------------------
# Scoping (AivinNet-Client#513). Three bugs of the same shape: backup and
# restore did not know the word "mine". Every one of them is invisible with a
# single user in the table, which is how the first round of tests here missed
# them — so these run with two.
# ---------------------------------------------------------------------------


def _rows() -> list[tuple[str, str, int]]:
    """(hash, type, userid) straight from SQL — the dataclass hides the prefix."""
    with DbEngine.manager() as session:
        return sorted(
            (r[0], r[1], r[2])
            for r in session.execute(select(FavoritesTable.hash, FavoritesTable.type, FavoritesTable.userid)).all()
        )


def test_the_backup_holds_only_my_favorites(favorites_db):
    FavoritesTable.insert_item({"hash": TRACK, "type": "track"})

    favorites_db.return_value = 2
    FavoritesTable.insert_item({"hash": ALBUM, "type": "album"})
    favorites_db.return_value = 1

    payload = _backup_payload()

    assert [entry["hash"] for entry in payload] == [TRACK]


def test_another_users_favorite_does_not_block_mine(favorites_db):
    """
    The reported case. User 2 favorited the track; user 1 restores a backup
    containing it. Comparing against every user's rows made it look present.
    """
    favorites_db.return_value = 2
    FavoritesTable.insert_item({"hash": TRACK, "type": "track"})
    favorites_db.return_value = 1

    _restore([{"hash": TRACK, "type": "track", "timestamp": 1700000000, "userid": 1, "extra": {}}])

    assert _rows() == sorted([(f"track_{TRACK}", "track", 1), (f"track_{TRACK}", "track", 2)])
    assert FavoritesTable.check_exists(TRACK, "track") is True


def test_a_pinned_album_does_not_block_the_album_favorite(favorites_db):
    """
    Same hash, different type. The old check compared the bare hash, so
    pinning an album silently swallowed its `album` favorite on restore.
    """
    FavoritesTable.insert_item({"hash": ALBUM, "type": "pinned_album"})

    _restore([{"hash": ALBUM, "type": "album", "timestamp": 1700000000, "userid": 1, "extra": {}}])

    assert (f"album_{ALBUM}", "album", 1) in _rows()


def test_a_foreign_userid_in_the_file_does_not_travel(favorites_db):
    """
    `insert_item` fills `userid` only when it is missing, so the id from the
    file used to survive: on a fresh instance it hit the `user.id` foreign key
    and the row was dropped by the swallowed IntegrityError; on a shared one it
    landed under the wrong owner. A backup is personal — restoring it means
    "give ME these back".
    """
    _restore([{"hash": TRACK, "type": "track", "timestamp": 1700000000, "userid": 2, "extra": {}}])

    assert _rows() == [(f"track_{TRACK}", "track", 1)]


def test_my_own_duplicate_is_still_skipped(favorites_db):
    """The scoping must not turn the dedup off — restoring twice stays a no-op."""
    FavoritesTable.insert_item({"hash": TRACK, "type": "track"})
    payload = _backup_payload()

    _restore(payload)
    _restore(payload)

    assert _rows() == [(f"track_{TRACK}", "track", 1)]
