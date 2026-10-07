"""The directory walk visits each folder once and survives a link back up (#391).

`run_fast_scandir` appended every child's descendants to the list it was still
looping over, so it walked each of them again, and their descendants again:
a chain of depth 12 cost 290 512 `iterdir()` calls for one file, a plain
Artist/Album/CD tree returned every file several times. And it had no notion
of a folder it had already seen, so a symlink (or a Windows junction) pointing
at an ancestor ran it into `RecursionError` and the whole scan died.
"""

import os
from pathlib import Path

import pytest

from aivinnet.utils.filesystem import run_fast_scandir


@pytest.fixture
def count_iterdir(monkeypatch):
    calls: list[Path] = []
    real = Path.iterdir

    def counting(self):
        calls.append(self)
        return real(self)

    monkeypatch.setattr(Path, "iterdir", counting)
    return calls


def test_a_deep_chain_is_listed_once_per_folder(tmp_path, count_iterdir):
    deep = tmp_path
    for level in range(8):
        deep = deep / f"d{level}"
    deep.mkdir(parents=True)
    (deep / "song.mp3").write_bytes(b"x")

    _dirs, files = run_fast_scandir(str(tmp_path), full=True)

    assert files == [(deep / "song.mp3").resolve().as_posix()]
    # The root and its eight folders, each listed once.
    assert len(count_iterdir) == 9


def test_an_artist_album_cd_tree_returns_every_file_once(tmp_path):
    expected = set()
    for artist in range(3):
        for album in range(2):
            for cd in range(2):
                folder = tmp_path / f"Artist {artist}" / f"Album {album}" / f"CD{cd + 1}"
                folder.mkdir(parents=True)
                for n in range(2):
                    song = folder / f"{n:02} Song.flac"
                    song.write_bytes(b"x")
                    expected.add(song.resolve().as_posix())

    dirs, files = run_fast_scandir(str(tmp_path), full=True)

    assert sorted(files) == sorted(expected)
    # 3 artists + 6 albums + 12 CDs, each named once.
    assert len(dirs) == len(set(dirs)) == 21


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_link_back_to_an_ancestor_does_not_end_the_scan(tmp_path):
    album = tmp_path / "Artist" / "Album"
    album.mkdir(parents=True)
    (album / "01 Song.mp3").write_bytes(b"x")
    (album / "loop").symlink_to(tmp_path, target_is_directory=True)

    _dirs, files = run_fast_scandir(str(tmp_path), full=True)

    assert files == [(album / "01 Song.mp3").resolve().as_posix()]


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_link_to_itself_is_skipped(tmp_path):
    (tmp_path / "song.mp3").write_bytes(b"x")
    (tmp_path / "self").symlink_to(tmp_path / "self")

    _dirs, files = run_fast_scandir(str(tmp_path), full=True)

    assert files == [(tmp_path / "song.mp3").resolve().as_posix()]


def test_a_folder_without_files_still_finds_what_is_below_it(tmp_path):
    """`full=False` descends only where the folder itself holds no music."""
    (tmp_path / "Artist" / "Album").mkdir(parents=True)
    (tmp_path / "Artist" / "Album" / "song.mp3").write_bytes(b"x")

    _dirs, files = run_fast_scandir(str(tmp_path))

    assert [Path(f).name for f in files] == ["song.mp3"]


def test_a_folder_that_cannot_be_listed_is_reported(tmp_path, monkeypatch):
    """Missing from the result is not the same as empty (#391)."""
    import errno

    ok = tmp_path / "Local"
    ok.mkdir()
    (ok / "song.mp3").write_bytes(b"x")
    stale = (tmp_path / "NFS").resolve()
    stale.mkdir()

    real = Path.iterdir

    def iterdir(self):
        if self == stale:
            raise OSError(errno.ESTALE, "Stale file handle")
        return real(self)

    monkeypatch.setattr(Path, "iterdir", iterdir)
    unreadable: set[str] = set()

    _dirs, files = run_fast_scandir(str(tmp_path), full=True, unreadable=unreadable)

    assert [Path(f).name for f in files] == ["song.mp3"]
    assert unreadable == {stale.as_posix()}
