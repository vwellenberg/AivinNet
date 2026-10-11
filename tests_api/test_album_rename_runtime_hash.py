"""The album rename carries references under the RUNTIME trackhash (#433).

Favourites, scrobbles and playlists store the hash the running server computes
for a track: `models/track.py::recreate_trackhash`, `create_hash(title, album,
artists)`. The scanner's column uses another argument order, `(artists, album,
title)`. The rename migration used to map old -> new with the column formula,
so no stored reference ever matched and nothing moved. A favourite of an
untagged track that was renamed to its folder silently lost its place.

These tests build the runtime hash directly, so they do not depend on the fix.
"""

import pytest
from sqlalchemy import delete, insert, select

from aivinnet.lib.albumhash import album_hash
from aivinnet.utils.hashing import create_hash

FOLDER = "/mnt/music/700-Games/Gothic 1 (2001)"
OLD_ALBUM = "14 swamp camp"  # what an untagged file had: its title, from the filename
NEW_ALBUM = "Gothic 1 (2001)"  # the folder name, after the rename
TITLE = "14 swamp camp"
ARTISTS = "Unknown"


def runtime_trackhash(title: str, album: str, artists: str) -> str:
    """The hash favourites and plays are stored with (one artist, as untagged files have)."""
    return create_hash(title, album, artists)


@pytest.fixture()
def untagged_track(playlist_db):
    """One untagged track in a folder-grouped album, as the scanner leaves it before the rename."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(TrackTable).values(
                album=OLD_ALBUM,
                albumartists=ARTISTS,
                albumhash=album_hash(None, FOLDER, ARTISTS),
                artists=ARTISTS,
                bitrate=320,
                copyright=None,
                date=None,
                disc=1,
                duration=180,
                filepath=f"{FOLDER}/14 swamp camp.mp3.mp3",
                folder=FOLDER,
                genres=None,
                last_mod=1.0,
                title=TITLE,
                track=14,
                # The column formula, as the scanner wrote it at the time.
                trackhash=create_hash(ARTISTS, OLD_ALBUM, TITLE),
                lastplayed=0,
                playcount=0,
                playduration=0,
                extra={},
            )
        )

    yield

    from aivinnet.db.userdata import FavoritesTable, ScrobbleTable

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(TrackTable))
        session.execute(delete(FavoritesTable))
        session.execute(delete(ScrobbleTable))


def test_the_premise_the_rename_changes_the_runtime_hash():
    # If this were equal the migration would have nothing to carry.
    assert runtime_trackhash(TITLE, OLD_ALBUM, ARTISTS) != runtime_trackhash(TITLE, NEW_ALBUM, ARTISTS)


def test_a_favourite_a_play_and_a_playlist_follow_the_rename(untagged_track):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable
    from aivinnet.migrations.album_title_from_folder import rename_albums_after_their_folder

    old = runtime_trackhash(TITLE, OLD_ALBUM, ARTISTS)
    new = runtime_trackhash(TITLE, NEW_ALBUM, ARTISTS)

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{old}", type="track", timestamp=1000, userid=1, extra={})
        )
        session.execute(
            insert(ScrobbleTable).values(trackhash=old, duration=180, timestamp=2000, source="al:x", userid=1, extra={})
        )
        session.execute(
            insert(PlaylistTable).values(
                name="Gothic",
                last_updated=0,
                image=None,
                userid=1,
                settings={},
                trackhashes=[old],
                extra={},
            )
        )

    report = rename_albums_after_their_folder()

    assert report["tracks"] == 1

    with DbEngine.manager() as session:
        assert session.execute(select(FavoritesTable.hash)).scalars().all() == [f"track_{new}"]
        assert session.execute(select(ScrobbleTable.trackhash)).scalars().all() == [new]
        assert session.execute(select(PlaylistTable.trackhashes)).scalars().one() == [new]
