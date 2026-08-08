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

    Same shape as `test_favorites_table_roundtrip.py`: user 1 has to exist
    because `favorite.userid` is a foreign key and the engine runs with
    PRAGMA foreign_keys=ON.
    """
    create_all_tables()

    with DbEngine.manager(commit=True) as session:
        exists = session.execute(select(UserTable.id).where(UserTable.id == 1)).first()
        if not exists:
            session.execute(insert(UserTable).values(id=1, username="restore-user", password="x", roles=[], extra={}))

    with patch("aivinnet.db.userdata.get_current_userid", return_value=1):
        yield

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
    """Exactly what `create_backup` writes: `asdict` over `get_all()`."""
    return [asdict(entry) for entry in FavoritesTable.get_all()]


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
    speak the same dialect, so restoring twice is a no-op.
    """
    _favorite_everything()
    payload = _backup_payload()

    _restore(payload)
    _restore(payload)

    assert len(_stored_hashes()) == 3
    assert len(set(_stored_hashes())) == 3
