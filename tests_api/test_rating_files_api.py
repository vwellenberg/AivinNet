"""Ratings in the audio files (#789) over the real request cycle, against real SQLite.

What these pin:

- flag off: setting or clearing a rating queues NO file write;
- flag on: every set and clear queues one write, and the write job puts the
  track's rating into EVERY file that shares its trackhash;
- the write job reads the last rater from the table (not the request), stops
  between files, and refuses to overwrite a leftover backup;
- import (admin only): creates the caller's missing ratings from the files,
  never overwrites an existing one, reports {imported, skipped, unreadable},
  and refuses a second run while one is going.
"""

import struct
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, insert, select

NOW = int(datetime(2026, 6, 1, tzinfo=UTC).timestamp())
TRACK = "1234567890abcdef"


# --- fixtures ---------------------------------------------------------------


def _mp3_bytes() -> bytes:
    return (b"\xff\xfb\x90\x00" + b"\x00" * 413) * 4


def _track(n: int, trackhash: str, filepath: str, title: str | None = None):
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
        filepath=filepath,
        folder="/music/Artist",
        genres="Rock",
        last_mod=NOW,
        title=title or f"Title {n}",
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
def two_users(api_client):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import TrackRatingTable, UserTable

    api_client("aivinnet.api.ratings")  # creates the tables, as the rating tests do
    with DbEngine.manager(commit=True) as session:
        for uid, name in ((1, "admin-rater"), (2, "plain-user")):
            if not session.execute(select(UserTable.id).where(UserTable.id == uid)).first():
                session.execute(insert(UserTable).values(id=uid, username=name, password="x", roles=[], extra={}))

    yield

    with DbEngine.manager(commit=True) as session:
        session.execute(delete(TrackRatingTable))


@pytest.fixture()
def flag(monkeypatch):
    """Set `writeRatingsToFiles` for one test; the singleton is restored afterwards."""
    from aivinnet.config import UserConfig

    def set_flag(value: bool) -> None:
        monkeypatch.setattr(UserConfig(), "writeRatingsToFiles", value)

    set_flag(False)
    return set_flag


@pytest.fixture()
def admin(monkeypatch):
    monkeypatch.setattr("aivinnet.api.auth.current_user", {"id": 1, "roles": ["admin"]})


@pytest.fixture()
def plain(monkeypatch):
    monkeypatch.setattr("aivinnet.api.auth.current_user", {"id": 2, "roles": []})


@pytest.fixture()
def ratings_api(api_client, monkeypatch, two_users):
    from aivinnet.api import ratings as ratings_module
    from aivinnet.lib import mbjobs

    mbjobs.reset_for_tests()
    handle = api_client("aivinnet.api.ratings")
    monkeypatch.setattr(ratings_module, "get_current_userid", lambda: handle.userid)
    return handle


def _stored() -> dict[tuple[str, int], int]:
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import TrackRatingTable

    with DbEngine.manager() as session:
        rows = session.execute(
            select(TrackRatingTable.trackhash, TrackRatingTable.userid, TrackRatingTable.rating)
        ).all()
    return {(r.trackhash, r.userid): r.rating for r in rows}


def _wait_job(job_id: str, timeout: float = 10.0) -> dict:
    import time

    from aivinnet.lib import mbjobs

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        slot = mbjobs.snapshot(job_id)
        if slot and slot["state"] != "running":
            return slot
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish")


@pytest.fixture()
def shared_hash_library(monkeypatch, tmp_path):
    """One trackhash, two files (an MP3 and a FLAC), like X.mp3 next to X.flac."""
    from aivinnet.store.tracks import TrackGroup, TrackStore

    mp3 = tmp_path / "X.mp3"
    mp3.write_bytes(_mp3_bytes())
    flac = tmp_path / "X.flac"
    flac.write_bytes(b"fLaC" + bytes([0x80]) + (34).to_bytes(3, "big") + _streaminfo())

    # The trackhash is derived from title, album and artist, so both files share the title.
    group = TrackGroup([_track(1, TRACK, str(mp3), "Same"), _track(2, TRACK, str(flac), "Same")])
    monkeypatch.setattr(TrackStore, "trackhashmap", {TRACK: group})
    return {"mp3": str(mp3), "flac": str(flac), "group": group}


def _streaminfo() -> bytes:
    body = struct.pack(">HH", 4096, 4096) + (0).to_bytes(3, "big") + (0).to_bytes(3, "big")
    body += ((44100 << 44) | (0 << 41) | (15 << 36) | 0).to_bytes(8, "big") + b"\x00" * 16
    return body


# --- the write path ---------------------------------------------------------


def test_flag_off_queues_no_file_write(ratings_api, flag, shared_hash_library, monkeypatch):
    from aivinnet.lib import rating_files

    queued = []
    monkeypatch.setattr(rating_files, "queue_write", lambda trackhash: queued.append(trackhash) or "j")

    ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 4})
    ratings_api.post("/ratings/clear", json={"trackhash": TRACK})

    assert queued == []


def test_flag_on_queues_one_write_per_set_and_clear(ratings_api, flag, shared_hash_library, monkeypatch):
    from aivinnet.lib import rating_files

    queued = []
    monkeypatch.setattr(rating_files, "queue_write", lambda trackhash: queued.append(trackhash) or "j")
    flag(True)

    assert ratings_api.post("/ratings/set", json={"trackhash": TRACK, "rating": 4}).status_code == 200
    assert ratings_api.post("/ratings/clear", json={"trackhash": TRACK}).status_code == 200

    assert queued == [TRACK, TRACK]


def test_a_refused_set_queues_nothing_even_with_the_flag_on(ratings_api, flag, shared_hash_library, monkeypatch):
    from aivinnet.lib import rating_files

    queued = []
    monkeypatch.setattr(rating_files, "queue_write", lambda trackhash: queued.append(trackhash) or "j")
    flag(True)

    ratings_api.post("/ratings/set", json={"trackhash": "0000000000000000", "rating": 4})

    assert queued == []


def test_the_write_job_puts_the_rating_into_every_file_of_the_hash(
    ratings_api, flag, shared_hash_library, two_users, monkeypatch
):
    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib import rating_tags
    from aivinnet.lib.rating_files import write_group

    TrackRatingTable.set_rating(TRACK, 1, 5)

    report = write_group(TRACK)

    assert report["written"] == 2
    assert report["failed"] == []
    assert rating_tags.read_rating(shared_hash_library["mp3"]) == 5
    assert rating_tags.read_rating(shared_hash_library["flac"]) == 5


def test_the_trackhash_is_unchanged_by_a_rating_write(shared_hash_library, two_users):
    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib.rating_files import write_group
    from aivinnet.store.tracks import TrackStore

    group = shared_hash_library["group"]
    before = [t.trackhash for t in group.tracks]

    TrackRatingTable.set_rating(TRACK, 1, 3)
    write_group(TRACK)

    assert list(TrackStore.trackhashmap) == [TRACK]
    assert [t.trackhash for t in group.tracks] == before


def test_the_last_rater_is_the_one_written(shared_hash_library, two_users):
    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib import rating_tags
    from aivinnet.lib.rating_files import write_group

    TrackRatingTable.set_rating(TRACK, 1, 2, timestamp=NOW)
    TrackRatingTable.set_rating(TRACK, 2, 5, timestamp=NOW + 60)

    write_group(TRACK)
    assert rating_tags.read_rating(shared_hash_library["mp3"]) == 5

    TrackRatingTable.clear_rating(TRACK, 2)
    write_group(TRACK)
    assert rating_tags.read_rating(shared_hash_library["mp3"]) == 2


def test_a_clear_with_no_rating_left_clears_the_files(shared_hash_library, two_users):
    from aivinnet.lib import rating_tags
    from aivinnet.lib.rating_files import write_group

    rating_tags.write_rating(shared_hash_library["mp3"], 4)
    report = write_group(TRACK)

    assert report["cleared"] == 2
    assert rating_tags.read_rating(shared_hash_library["mp3"]) is None


def test_a_stop_ends_the_write_between_files_and_says_so(shared_hash_library, two_users, monkeypatch):
    from aivinnet.lib import rating_tags
    from aivinnet.lib.rating_files import write_group
    from aivinnet.utils.shutdown import WRITERS

    monkeypatch.setattr(WRITERS, "stopping", lambda: True)

    report = write_group(TRACK)

    assert report["stopped"] is True
    assert report["written"] == 0
    assert rating_tags.read_rating(shared_hash_library["mp3"]) is None


def test_a_leftover_backup_blocks_the_write_and_is_kept(shared_hash_library, two_users, tmp_path):
    from aivinnet.lib import rating_tags
    from aivinnet.lib.rating_files import write_group

    backup = shared_hash_library["mp3"] + ".bak"
    with open(backup, "wb") as f:
        f.write(b"the only intact copy")

    report = write_group(TRACK)

    assert any(entry["filepath"] == shared_hash_library["mp3"] for entry in report["failed"])
    assert rating_tags.read_rating(shared_hash_library["mp3"]) is None
    with open(backup, "rb") as f:
        assert f.read() == b"the only intact copy"


def test_a_write_leaves_no_backup_behind(shared_hash_library, two_users):
    import os

    from aivinnet.db.userdata import TrackRatingTable
    from aivinnet.lib.rating_files import write_group

    TrackRatingTable.set_rating(TRACK, 1, 4)
    write_group(TRACK)

    assert not os.path.exists(shared_hash_library["mp3"] + ".bak")
    assert not os.path.exists(shared_hash_library["flac"] + ".bak")


# --- the table helpers ------------------------------------------------------


def test_insert_missing_never_overwrites_an_existing_rating(two_users):
    from aivinnet.db.userdata import TrackRatingTable

    TrackRatingTable.set_rating("hash-a", 1, 2)
    TrackRatingTable.insert_missing(1, {"hash-a": 5, "hash-b": 3})

    assert _stored() == {("hash-a", 1): 2, ("hash-b", 1): 3}


# --- import -----------------------------------------------------------------


def _mp3_with_popm(path, email: str | None, value: int | None) -> None:
    path.write_bytes(_mp3_bytes())
    if email is None:
        return
    from mutagen.id3 import POPM
    from mutagen.mp3 import MP3

    audio = MP3(str(path))
    audio.add_tags()
    audio.tags.add(POPM(email=email, rating=value, count=0))
    audio.save()


@pytest.fixture()
def import_library(monkeypatch, tmp_path):
    """
    Five tracks, one per outcome:
    A  WMP POPM 196 (4 stars) and nothing rated yet        -> imported
    B  POPM 255 but user 1 already rated it 1              -> skipped (existing wins)
    C  an MP3 with no POPM at all                          -> skipped
    D  a .wma (no reader)                                   -> skipped
    E  a FLAC that is not a FLAC                            -> unreadable
    """
    from aivinnet.store.tracks import TrackGroup, TrackStore

    a = tmp_path / "a.mp3"
    _mp3_with_popm(a, "Windows Media Player 9 Series", 196)
    b = tmp_path / "b.mp3"
    _mp3_with_popm(b, "Windows Media Player 9 Series", 255)
    c = tmp_path / "c.mp3"
    _mp3_with_popm(c, None, None)
    d = tmp_path / "d.wma"
    d.write_bytes(b"not read")
    e = tmp_path / "e.flac"
    e.write_bytes(b"this is not flac")

    groups = {
        "hash-a": TrackGroup([_track(1, "hash-a", str(a))]),
        "hash-b": TrackGroup([_track(2, "hash-b", str(b))]),
        "hash-c": TrackGroup([_track(3, "hash-c", str(c))]),
        "hash-d": TrackGroup([_track(4, "hash-d", str(d))]),
        "hash-e": TrackGroup([_track(5, "hash-e", str(e))]),
    }
    monkeypatch.setattr(TrackStore, "trackhashmap", groups)
    return groups


def test_import_is_admin_only(ratings_api, plain, import_library):
    assert ratings_api.post("/ratings/import-from-files").status_code == 403
    assert ratings_api.get("/ratings/import-from-files/job/deadbeef").status_code == 403


def test_import_creates_missing_ratings_and_reports_the_counts(ratings_api, admin, import_library, two_users):
    from aivinnet.db.userdata import TrackRatingTable

    TrackRatingTable.set_rating("hash-b", 1, 1)

    res = ratings_api.post("/ratings/import-from-files")
    assert res.status_code == 200
    slot = _wait_job(res.json["job"])

    assert slot["state"] == "done"
    assert slot["result"] == {"imported": 1, "skipped": 3, "unreadable": 1}
    assert _stored() == {("hash-a", 1): 4, ("hash-b", 1): 1}


def test_import_updates_the_ram_ratings_of_the_caller(ratings_api, admin, import_library, two_users):
    res = ratings_api.post("/ratings/import-from-files")
    _wait_job(res.json["job"])

    assert import_library["hash-a"].tracks[0].rating_of(1) == 4


def test_a_second_import_while_one_runs_is_refused(ratings_api, admin, import_library, two_users):
    from aivinnet.lib import rating_files

    assert rating_files._import_lock.acquire(blocking=False)
    try:
        res = ratings_api.post("/ratings/import-from-files")
    finally:
        rating_files._import_lock.release()

    assert res.status_code == 409


def test_an_unknown_import_job_is_404(ratings_api, admin):
    assert ratings_api.get("/ratings/import-from-files/job/deadbeef").status_code == 404
