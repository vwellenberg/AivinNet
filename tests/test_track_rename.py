"""Renaming track files on disk (#144) — against real files in a temp folder.

The library side (database row, TrackStore, FolderStore) is faked: what matters
here is the order of operations and what happens when one of them fails. The
promise under test is that disk and library never disagree about where a track
is, and that nothing is overwritten.
"""

import os
import sys
from unittest.mock import MagicMock, patch

with patch.dict(
    sys.modules,
    {
        name: MagicMock()
        for name in [
            "aivinnet.db.libdata",
            "aivinnet.store.folder",
            "aivinnet.store.tracks",
        ]
    },
):
    from aivinnet.lib import track_rename

import pytest


class FakeTrack:
    def __init__(self, filepath: str, trackhash: str = "h"):
        self.filepath = filepath
        self.trackhash = trackhash


class FakeLibrary:
    """The database row and the TrackStore, as far as a rename touches them."""

    def __init__(self, paths):
        self.tracks = [FakeTrack(path, f"hash-{i}") for i, path in enumerate(paths)]
        self.fail_db = False

    @property
    def rows(self):
        """Where the in-memory Track objects think their files are."""
        return {track.filepath: track.trackhash for track in self.tracks}

    # TrackStore
    def get_flat_list(self):
        return list(self.tracks)

    # TrackTable
    def update_filepath(self, old, new):
        if self.fail_db:
            raise RuntimeError("database is locked")
        return 1 if old in self.rows else 0


@pytest.fixture()
def album(tmp_path, monkeypatch):
    def make(*names, lyrics=()):
        paths = []
        for name in names:
            path = tmp_path / name
            path.write_bytes(name.encode())
            paths.append(str(path))
        for name in lyrics:
            (tmp_path / name).write_text("[00:01.00] la")

        library = FakeLibrary(paths)
        monkeypatch.setattr(track_rename, "TrackStore", library)
        monkeypatch.setattr(track_rename, "TrackTable", library)
        folder = MagicMock()
        monkeypatch.setattr(track_rename, "FolderStore", folder)
        return tmp_path, library, folder

    return make


def names(folder):
    return sorted(os.listdir(folder))


def test_it_renames_the_file_and_tells_every_index(album):
    folder, library, folder_store = album("68.mp3")
    old = str(folder / "68.mp3")

    applied, failed = track_rename.rename_files([(old, "68 - Night Woods.mp3")])

    assert failed == []
    assert applied == [{"filepath": old, "new_filepath": str(folder / "68 - Night Woods.mp3")}]
    assert names(folder) == ["68 - Night Woods.mp3"]
    # Content is the same file, moved — not a copy.
    assert (folder / "68 - Night Woods.mp3").read_bytes() == b"68.mp3"
    assert str(folder / "68 - Night Woods.mp3") in library.rows
    folder_store.move_filepath.assert_called_once_with(old, str(folder / "68 - Night Woods.mp3"), "hash-0")


def test_the_lyrics_file_moves_with_it(album):
    folder, _library, _ = album("68.mp3", lyrics=["68.lrc"])

    track_rename.rename_files([(str(folder / "68.mp3"), "68 - Night Woods.mp3")])

    assert names(folder) == ["68 - Night Woods.lrc", "68 - Night Woods.mp3"]


def test_a_failed_database_update_moves_the_file_back(album):
    folder, library, folder_store = album("68.mp3")
    library.fail_db = True
    old = str(folder / "68.mp3")

    applied, failed = track_rename.rename_files([(old, "68 - Night Woods.mp3")])

    assert applied == []
    assert failed[0]["filepath"] == old
    assert "database is locked" in failed[0]["error"]
    # Disk and library agree again: the file is where the library thinks it is.
    assert names(folder) == ["68.mp3"]
    assert old in library.rows
    folder_store.move_filepath.assert_not_called()


def test_an_existing_file_is_never_overwritten(album):
    folder, _library, _ = album("x.mp3", "01 - A.mp3")

    applied, failed = track_rename.rename_files([(str(folder / "x.mp3"), "01 - A.mp3")])

    assert applied == []
    assert failed[0]["error"] == "Another file already has that name"
    assert (folder / "01 - A.mp3").read_bytes() == b"01 - A.mp3"
    assert (folder / "x.mp3").exists()


def test_a_renumbered_album_moves_in_the_order_that_frees_the_names(album):
    folder, _library, _ = album("02 - B.mp3", "03 - B.mp3")

    applied, failed = track_rename.rename_files(
        [
            (str(folder / "02 - B.mp3"), "03 - B.mp3"),
            (str(folder / "03 - B.mp3"), "04 - B.mp3"),
        ]
    )

    assert failed == []
    assert len(applied) == 2
    assert (folder / "03 - B.mp3").read_bytes() == b"02 - B.mp3"
    assert (folder / "04 - B.mp3").read_bytes() == b"03 - B.mp3"


@pytest.mark.parametrize(
    "name",
    [
        "../escaped.mp3",
        "sub/dir.mp3",
        ".hidden.mp3",
        "renamed.exe",
        "renamed",
        "what?.mp3",
        "",
    ],
)
def test_a_name_from_the_client_is_checked_as_input(album, name):
    folder, _library, _ = album("x.mp3")

    applied, failed = track_rename.rename_files([(str(folder / "x.mp3"), name)])

    assert applied == []
    assert len(failed) == 1
    assert names(folder) == ["x.mp3"]


def test_a_file_the_library_does_not_know_is_not_touched(album, tmp_path):
    album("x.mp3")
    stranger = tmp_path / "stranger.mp3"
    stranger.write_bytes(b"not indexed")

    applied, failed = track_rename.rename_files([(str(stranger), "01 - Stranger.mp3")])

    assert applied == []
    assert failed == [{"filepath": str(stranger), "error": "Track not found"}]
    assert stranger.exists()


def test_renames_run_one_at_a_time(monkeypatch):
    """The album apply (worker) and the editor (request) share one lock."""
    seen = []
    monkeypatch.setattr(
        track_rename, "_rename_files", lambda moves: seen.append(track_rename._rename_lock.locked()) or ([], [])
    )

    track_rename.rename_files([])

    assert seen == [True]
    assert not track_rename._rename_lock.locked()


class AlbumTrack:
    def __init__(self, filepath, title, track, disc=1):
        self.filepath, self.title, self.track, self.disc, self.albumhash = filepath, title, track, disc, "a"


def test_a_single_track_is_named_the_way_its_album_would_be(monkeypatch):
    """The editor renames one track; its name must match the album-wide pattern."""
    album = [AlbumTrack(f"/m/A/{n}.mp3", f"T{n}", n) for n in (1, 2, 120)]
    monkeypatch.setattr(track_rename, "TrackStore", MagicMock(get_tracks_by_albumhash=lambda _h: album))

    # Three digits because the ALBUM goes past 99 — not because this track does.
    assert track_rename.name_after_tags(AlbumTrack("/m/A/x.flac", "Game Lost", 3)) == "003 - Game Lost.flac"


def test_a_single_track_on_a_two_disc_album_gets_its_disc(monkeypatch):
    album = [AlbumTrack("/m/A/a.mp3", "A", 1, 1), AlbumTrack("/m/A/b.mp3", "B", 1, 2)]
    monkeypatch.setattr(track_rename, "TrackStore", MagicMock(get_tracks_by_albumhash=lambda _h: album))

    assert track_rename.name_after_tags(album[1]) == "2-01 - B.mp3"


def test_one_failure_does_not_stop_the_rest(album):
    folder, _library, _ = album("a.mp3", "b.mp3", "01 - Taken.mp3")

    applied, failed = track_rename.rename_files(
        [
            (str(folder / "a.mp3"), "01 - Taken.mp3"),
            (str(folder / "b.mp3"), "02 - Free.mp3"),
        ]
    )

    assert [entry["filepath"] for entry in failed] == [str(folder / "a.mp3")]
    assert [entry["new_filepath"] for entry in applied] == [str(folder / "02 - Free.mp3")]
