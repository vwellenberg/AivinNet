"""
Backup -> restore of favorites, against a real SQLite database.

The bug this pins down (AivinNet-Client#451) is invisible to every check the
code itself makes: a backup stores `hash` exactly as the column holds it —
type prefix included — and the restore fed that straight back through
`FavoritesTable.insert_item`, which prefixes. The result was rows like
`track_track_<hash>`. They satisfy the schema, they satisfy the unique
constraint, the restore reports success — and no lookup ever matches them
again, so the restored favorites are simply not there any more.

That is why this is a round-trip against real SQL rather than a mocked call:
the defect is in what ends up STORED, and the only assertion that catches it
is asking the app's own lookup whether it can still find the item.
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
    with DbEngine.manager() as session:
        return [row[0] for row in session.execute(select(FavoritesTable.hash)).all()]


def _favorite_everything():
    """Favorite one of each type the way the API does — with RAW hashes."""
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
    the favorites one is under test here, so the method is called on an
    uninitialised instance.
    """
    RestoreBackup.restore_favorites(object.__new__(RestoreBackup), payload)


def test_backup_stores_the_prefixed_hash(favorites_db):
    """The premise: what lands in the backup already carries the prefix."""
    _favorite_everything()

    payload = _backup_payload()
    hashes = sorted(entry["hash"] for entry in payload)

    assert hashes == sorted([f"track_{TRACK}", f"album_{ALBUM}", f"artist_{ARTIST}"])


def test_restore_does_not_double_the_type_prefix(favorites_db):
    _favorite_everything()
    payload = _backup_payload()
    before = sorted(_stored_hashes())

    _wipe()
    _restore(payload)

    assert sorted(_stored_hashes()) == before
    assert not any(h.startswith(("track_track_", "album_album_", "artist_artist_")) for h in _stored_hashes()), (
        "restored rows carry the type prefix twice"
    )


def test_restored_favorites_are_visible_again(favorites_db):
    """
    The assertion that actually mattered to the user.

    `check_exists` is what `/favorites/check` and the heart in the client ask.
    With the doubled prefix every one of these came back False while the rows
    sat in the table.
    """
    _favorite_everything()
    payload = _backup_payload()

    _wipe()
    assert FavoritesTable.check_exists(TRACK, "track") is False

    _restore(payload)

    assert FavoritesTable.check_exists(TRACK, "track") is True
    assert FavoritesTable.check_exists(ALBUM, "album") is True
    assert FavoritesTable.check_exists(ARTIST, "artist") is True


def test_restore_skips_favorites_that_are_still_there(favorites_db):
    """
    Restoring over a live library must not duplicate rows.

    The dedup check compares the backup's hash against the stored column, so it
    was always right — but `insert_prefixed_item` has to agree with it, or a
    second restore would insert the same item under a different spelling.
    """
    _favorite_everything()
    payload = _backup_payload()

    _restore(payload)

    assert len(_stored_hashes()) == 3
    assert len(set(_stored_hashes())) == 3


def test_insert_item_still_prefixes_raw_hashes(favorites_db):
    """
    The other half of the split: the normal /favorites/add path is unchanged.

    Guards against "fixing" the restore by dropping the prefix logic outright,
    which would collide a track and an album that share a hash.
    """
    FavoritesTable.insert_item({"hash": TRACK, "type": "track"})

    assert _stored_hashes() == [f"track_{TRACK}"]
