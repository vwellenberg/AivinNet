"""Plays left on a hash no file holds follow their file (lib/orphaned_plays.py).

Live, 2026-11-20: "Almost complete" counted "Monkey Island 2" as unplayed
although it had four plays. They were logged while the untagged file's album
was its own title; the album rename after the folder (#63) gave it a new hash
and, until #442, moved none of its references. 1199 plays of 269 tracks sat on
such hashes, every one of them from before the paths that carry references
today existed. Each play stores its file's path, which is the way back.

The track comes from the real model (`track_to_dataclass`), so its hash is the
one the server computes, not a stand-in.
"""

import pytest
from sqlalchemy import delete, insert, select

from aivinnet.utils.hashing import create_hash

FOLDER = "/m/700-Games/Monkey Island"
PATH = f"{FOLDER}/Monkey_Island_2.mp3"
# The hash it was logged under: no album tag, so the album was the title.
OLD = create_hash("Monkey Island 2", "Monkey Island 2", "Unknown")


def _track(n: int, title: str, filepath: str):
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass

    row = {
        "id": n,
        "album": "Monkey Island",
        "albumartists": "Unknown",
        "albumhash": create_hash("Monkey Island", FOLDER),
        "artists": "Unknown",
        "bitrate": 320,
        "copyright": "",
        "date": 0,
        "disc": 1,
        "duration": 262,
        "filepath": filepath,
        "folder": FOLDER,
        "genres": None,
        "last_mod": 1,
        "title": title,
        "track": 1,
        "trackhash": "",
        "extra": {},
        "lastplayed": 0,
        "playcount": 0,
        "playduration": 0,
    }
    return track_to_dataclass(row, UserConfig())


@pytest.fixture()
def reference_db(playlist_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, ScrobbleTable

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(FavoritesTable))
            session.execute(delete(ScrobbleTable))

    wipe()
    yield
    wipe()


def _play(trackhash: str, filepath: str | None):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import ScrobbleTable

    extra = {"filepath": filepath, "title": "Monkey Island 2"} if filepath else {}
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(ScrobbleTable).values(
                trackhash=trackhash, duration=228, timestamp=1780443323, source="pl:9", userid=1, extra=extra
            )
        )


def _scrobbles() -> list[str]:
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import ScrobbleTable

    with DbEngine.manager() as session:
        return sorted(session.execute(select(ScrobbleTable.trackhash)).scalars().all())


def test_the_premise_the_old_hash_is_not_the_one_the_server_uses():
    assert _track(1, "Monkey Island 2", PATH).trackhash != OLD


def test_a_play_on_a_hash_no_file_holds_counts_for_its_file_again(reference_db):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable
    from aivinnet.lib.orphaned_plays import carry_orphaned_plays

    track = _track(1, "Monkey Island 2", PATH)
    for _ in range(4):
        _play(OLD, PATH)
    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(PlaylistTable).values(
                name="Games", last_updated=0, image=None, userid=1, settings={}, trackhashes=[OLD], extra={}
            )
        )
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{OLD}", type="track", timestamp=1, userid=1, extra={})
        )

    # What "Almost complete" asks. Red before the carry: the plays count for no track.
    assert track.trackhash not in ScrobbleTable.heard_trackhashes_of(1)

    assert carry_orphaned_plays([track]) == 1

    assert ScrobbleTable.heard_trackhashes_of(1) == {track.trackhash}
    assert _scrobbles() == [track.trackhash] * 4
    with DbEngine.manager() as session:
        assert session.execute(select(PlaylistTable.trackhashes)).scalars().all() == [[track.trackhash]]
        assert session.execute(select(FavoritesTable.hash)).scalars().all() == [f"track_{track.trackhash}"]


def test_what_has_no_way_back_stays(reference_db):
    from aivinnet.lib.orphaned_plays import carry_orphaned_plays

    track = _track(1, "Monkey Island 2", PATH)
    _play(OLD, f"{FOLDER}/deleted.mp3")  # the file is gone
    _play("nopath0nopath000", None)  # a play from before `extra.filepath`
    _play(track.trackhash, PATH)  # already right

    assert carry_orphaned_plays([track]) == 0
    assert _scrobbles() == sorted([OLD, "nopath0nopath000", track.trackhash])


def test_an_old_hash_another_file_still_holds_keeps_its_plays(reference_db):
    from aivinnet.lib.orphaned_plays import carry_orphaned_plays

    # A twin with the old tags still carries OLD: the plays may be its.
    moved = _track(1, "Monkey Island 2", PATH)
    twin = _track(2, "Monkey Island 2", f"{FOLDER}/twin.mp3")
    object.__setattr__(twin, "trackhash", OLD)
    _play(OLD, PATH)

    assert carry_orphaned_plays([moved, twin]) == 0
    assert _scrobbles() == [OLD]


def test_the_second_start_finds_nothing(reference_db):
    from aivinnet.lib.orphaned_plays import carry_orphaned_plays

    track = _track(1, "Monkey Island 2", PATH)
    _play(OLD, PATH)
    carry_orphaned_plays([track])

    assert carry_orphaned_plays([track]) == 0
    assert _scrobbles() == [track.trackhash]


def test_a_failure_does_not_stop_the_start(reference_db, monkeypatch):
    from aivinnet.lib import orphaned_plays

    def broken(_tracks):
        raise RuntimeError("database locked")

    monkeypatch.setattr(orphaned_plays, "_carry", broken)

    assert orphaned_plays.carry_orphaned_plays([]) == 0
