"""A tag edit is not new music.

"Recently added" ranked folders by the mtime of their newest file. A tag edit,
a cover written into a file or an album apply sets that to now, so a folder of
long-known music came up on Home as "NEW MUSIC" (100-Musicians, 2954 tracks,
after a round of tag repairs). Since then each row carries `added`, which every
rewrite of the row keeps: the rescan of a changed file and the app's own tag
edit. Rows from before the column get it from the backfill.
"""

import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, delete, insert, select, text

LONG_AGO = 1_700_000_000
LAST_WEEK = 1_790_000_000
YESTERDAY = LAST_WEEK + 6 * 86_400

FRAME = b"\xff\xfb\x90\x00" + b"\x00" * 413


def _row(filepath: str, last_mod: int, **overrides) -> dict:
    folder, name = filepath.rsplit("/", 1)
    return {
        "album": "Album",
        "albumartists": "Artist",
        "albumhash": "albumhash0000000",
        "artists": "Artist",
        "bitrate": 128,
        "copyright": "",
        "date": 1735689600,
        "disc": 1,
        "duration": 148,
        "filepath": filepath,
        "folder": folder,
        "genres": None,
        "last_mod": last_mod,
        "title": name,
        "track": 1,
        "trackhash": "stale-db-hash000",
        "extra": {},
        **overrides,
    }


def _insert(row: dict) -> int:
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    with DbEngine.manager(commit=True) as session:
        return session.execute(insert(TrackTable).values(row)).inserted_primary_key[0]


def _live(row: dict, rowid: int):
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass

    return track_to_dataclass({**row, "id": rowid, "lastplayed": 0, "playcount": 0, "playduration": 0}, UserConfig())


@pytest.fixture()
def tracks_db(playlist_db):
    """The real track and scrobble tables, emptied before and after."""
    from aivinnet.db import create_all_tables
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.userdata import ScrobbleTable

    create_all_tables()

    def wipe():
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(TrackTable))
            session.execute(delete(ScrobbleTable))

    wipe()
    yield
    wipe()


def _rows() -> dict[str, tuple[int, int | None]]:
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.libdata import TrackTable

    with DbEngine.manager() as session:
        rows = session.execute(select(TrackTable.filepath, TrackTable.last_mod, TrackTable.added)).all()
    return {Path(path).name: (last_mod, added) for path, last_mod, added in rows}


# --- the column ------------------------------------------------------------


@pytest.fixture()
def old_database(tmp_path, monkeypatch):
    """A track table as every version before this one created it."""
    from aivinnet.db.engine import DbEngine

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE track (id INTEGER PRIMARY KEY, filepath VARCHAR NOT NULL, last_mod INTEGER NOT NULL)"
        )
        conn.exec_driver_sql("INSERT INTO track (id, filepath, last_mod) VALUES (1, '/m/a.mp3', 1700000000)")
    monkeypatch.setattr(DbEngine, "_engine", engine)
    yield engine
    engine.dispose()


def test_an_old_database_gets_the_column_empty_and_only_once(old_database):
    from aivinnet.migrations.track_added import add_track_added_column

    add_track_added_column()
    add_track_added_column()

    with old_database.connect() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(track)"))]
        assert columns.count("added") == 1
        # Empty, not the mtime: the backfill has evidence the column has not.
        assert conn.execute(text("SELECT added FROM track")).scalar() is None


# --- the rows from before the column ---------------------------------------


def test_the_backfill_dates_a_retagged_track_by_its_first_play(tracks_db):
    """The reported case: played for years, retagged yesterday."""
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import ScrobbleTable
    from aivinnet.lib.date_added import backfill_added

    rows = {
        "retagged.mp3": _row("/m/100-Musicians/retagged.mp3", YESTERDAY, title="Retagged"),
        "new.mp3": _row("/m/New/new.mp3", LAST_WEEK, title="New"),
        "unplayed.mp3": _row("/m/100-Musicians/unplayed.mp3", YESTERDAY, title="Unplayed"),
    }
    live = []
    for row in rows.values():
        live.append(_live(row, _insert(row)))
    retagged, new, unplayed = live

    def play(trackhash: str, at: int) -> dict:
        return {"trackhash": trackhash, "duration": 200, "timestamp": at, "source": "", "userid": 1, "extra": {}}

    with DbEngine.manager(commit=True) as session:
        # The store's hash, not the one in the row: plays are logged under it.
        session.execute(insert(ScrobbleTable), [play(retagged.trackhash, LONG_AGO), play(new.trackhash, YESTERDAY)])

    assert backfill_added(live) == 1

    assert _rows() == {
        "retagged.mp3": (YESTERDAY, LONG_AGO),
        "new.mp3": (LAST_WEEK, LAST_WEEK),
        # Nothing tells it apart from new music: the rewrite stays its date.
        "unplayed.mp3": (YESTERDAY, YESTERDAY),
    }
    assert (retagged.added, new.added, unplayed.added) == (LONG_AGO, LAST_WEEK, YESTERDAY)


def test_a_filled_library_is_left_alone(tracks_db, monkeypatch):
    from aivinnet.db.userdata import ScrobbleTable
    from aivinnet.lib.date_added import backfill_added

    _insert(_row("/m/a.mp3", YESTERDAY, added=LONG_AGO))
    monkeypatch.setattr(
        ScrobbleTable, "first_play_by_trackhash", classmethod(lambda cls: pytest.fail("read the history"))
    )

    assert backfill_added([]) == 0
    assert _rows() == {"a.mp3": (YESTERDAY, LONG_AGO)}


def test_a_row_gone_meanwhile_does_not_undo_the_fill(tracks_db):
    """A tag edit swapped the row (new id) between the read and the write."""
    from aivinnet.db.libdata import TrackTable

    dated = _insert(_row("/m/dated.mp3", YESTERDAY))
    _insert(_row("/m/plain.mp3", LAST_WEEK))

    TrackTable.fill_added({dated: LONG_AGO, dated + 1000: LONG_AGO})

    assert _rows() == {"dated.mp3": (YESTERDAY, LONG_AGO), "plain.mp3": (LAST_WEEK, LAST_WEEK)}


# --- a rewrite keeps the date ------------------------------------------------


@pytest.fixture()
def scan(tracks_db, tmp_path, monkeypatch):
    """The real scan over real MP3s, in this process."""
    from mutagen.easyid3 import EasyID3

    from aivinnet.config import UserConfig
    from aivinnet.lib import tagger

    root = tmp_path / "music"
    root.mkdir()
    real = UserConfig()

    class Config:
        rootDirs = [root.as_posix()]
        excludeDirs: list[str] = []

        def __getattr__(self, name):
            return getattr(real, name)

    class InlinePool:
        def __init__(self, processes):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def imap_unordered(self, func, items):
            return map(func, items)

    monkeypatch.setattr(tagger, "UserConfig", Config)
    monkeypatch.setattr(tagger, "Pool", InlinePool)
    monkeypatch.setattr(tagger.IndexTracks, "extract_thumb_with_overwrite", staticmethod(lambda tracks: None))

    def song(name: str, title: str, mtime: int) -> Path:
        path = root / name
        path.write_bytes(FRAME * 4)
        tags = EasyID3()
        tags.update({"title": title, "artist": "Artist", "album": "Album"})
        tags.save(path)
        os.utime(path, (mtime, mtime))
        return path

    return SimpleNamespace(song=song, run=tagger.IndexTracks)


def test_a_rescan_of_a_changed_file_keeps_when_it_was_added(scan):
    song = scan.song("song.mp3", "Song", LONG_AGO)
    scan.run()
    assert _rows() == {"song.mp3": (LONG_AGO, LONG_AGO)}

    # A tag editor (or a cover written into the file) rewrites it.
    os.utime(song, (YESTERDAY, YESTERDAY))
    scan.song("new.mp3", "New", LAST_WEEK)
    scan.run()

    assert _rows() == {"song.mp3": (YESTERDAY, LONG_AGO), "new.mp3": (LAST_WEEK, LAST_WEEK)}


@pytest.fixture()
def edit(tracks_db, tmp_path, monkeypatch):
    """One track in the DB and the store; the editor writes the file for real."""
    from aivinnet.lib import track_edit
    from aivinnet.store.tracks import TrackStore

    song = tmp_path / "song.mp3"
    song.write_bytes(b"ORIGINAL")
    os.utime(song, (LONG_AGO, LONG_AGO))
    path = song.as_posix()

    def fake_get_tags(filepath, config):
        title = "New" if Path(filepath).read_bytes() == b"EDITED" else "Old"
        return _row(filepath, round(os.path.getmtime(filepath)), title=title)

    def write_tags(filepath, fields):
        song.write_bytes(b"EDITED")
        os.utime(song, (YESTERDAY, YESTERDAY))

    monkeypatch.setattr(track_edit, "get_tags", fake_get_tags)
    monkeypatch.setattr(track_edit.tag_writer, "write_tags", write_tags)
    monkeypatch.setattr(track_edit, "extract_thumb", lambda *a, **k: None)
    monkeypatch.setattr(track_edit, "_reconcile_album", lambda albumhash: None)
    monkeypatch.setattr(track_edit, "_reconcile_artist", lambda artisthash: None)
    monkeypatch.setattr(track_edit.FolderStore, "index_file", lambda *a: None)
    monkeypatch.setattr(TrackStore, "trackhashmap", {})

    row = _row(path, LONG_AGO, title="Old", added=LONG_AGO - 86_400)
    TrackStore.add_track(_live(row, _insert(row)))
    return path


def test_a_tag_edit_in_the_app_keeps_when_the_file_was_added(edit):
    from aivinnet.lib import track_edit

    track = track_edit.edit_track_tags_by_filepath(edit, {"title": "New"})

    assert _rows() == {"song.mp3": (YESTERDAY, LONG_AGO - 86_400)}
    assert (track.title, track.added) == ("New", LONG_AGO - 86_400)


# --- what Home shows -------------------------------------------------------


def test_a_retagged_folder_is_not_recently_added(tmp_path, monkeypatch):
    """The screenshot: 100-Musicians above an album that really is new."""
    from aivinnet.lib.home import recentlyadded
    from aivinnet.store.albums import AlbumMapEntry
    from aivinnet.store.artists import ArtistMapEntry
    from aivinnet.store.tracks import TrackStore

    musicians = tmp_path / "100-Musicians"
    album = tmp_path / "200-Band" / "New Album"
    musicians.mkdir()
    album.mkdir(parents=True)

    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    rowid = 0

    def add(folder: Path, n: int, last_mod: int, added: int, **tags):
        nonlocal rowid
        rowid += 1
        row = _row(f"{folder.as_posix()}/{n:02d}.mp3", last_mod, title=f"Song {n}", added=added, **tags)
        track = _live(row, rowid)
        TrackStore.add_track(track)
        return track

    # Loose singles by four artists, there for years. One got its tags fixed yesterday.
    for n in range(4):
        last_mod = YESTERDAY if n == 0 else LONG_AGO
        add(
            musicians,
            n,
            last_mod,
            LONG_AGO,
            artists=f"Artist {n}",
            albumartists=f"Artist {n}",
            album=f"Single {n}",
            albumhash=f"single{n:011d}",
        )
    new = [add(album, n, LAST_WEEK, LAST_WEEK, albumhash="newalbum00000000") for n in range(5)]

    monkeypatch.setattr(
        recentlyadded.AlbumStore,
        "albummap",
        {"newalbum00000000": AlbumMapEntry(SimpleNamespace(created_date=LAST_WEEK), set())},
    )
    artists = {h for t in new for h in t.artisthashes}
    monkeypatch.setattr(
        recentlyadded.ArtistStore,
        "artistmap",
        {h: ArtistMapEntry(SimpleNamespace(created_date=LONG_AGO), set(), set()) for h in artists},
    )

    items = recentlyadded.get_recently_added_items(limit=2)

    assert items[0] == {"type": "album", "hash": "newalbum00000000", "timestamp": LAST_WEEK, "help_text": "NEW ALBUM"}
    assert items[1]["hash"] == f"{musicians.as_posix()}/"
    assert items[1]["timestamp"] == LONG_AGO

    # The "Recently Added" playlist reads the same list.
    assert recentlyadded.get_recently_added_tracks(limit=1)[0].folder == f"{album.as_posix()}/"
