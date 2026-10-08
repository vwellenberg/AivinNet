"""Folder counts and sorting on the paths the scanner actually stores (#391).

- A count asked `startswith(dir)` with no separator, so `/music/Rock` also
  counted `/music/Rock and Roll/...`.
- The scanner stores RESOLVED paths, but a root is counted as configured: a
  root reached through a symlink counted 0 and vanished from the Folders page.
- Sorting a folder by artist read `artists[0]`; a track whose artist tag
  split to nothing raised IndexError, and `/folder` answered 500. Sorting
  folders by date stat'ed each one; a folder gone meanwhile did the same.
"""

import os
from types import SimpleNamespace

import pytest
from sortedcontainers import SortedSet


@pytest.fixture()
def stored(monkeypatch):
    from aivinnet.store.folder import FolderStore

    def store(*paths):
        monkeypatch.setattr(FolderStore, "filepaths", SortedSet(paths))
        return FolderStore

    return store


def test_a_sibling_with_the_same_prefix_is_not_counted(stored, tmp_path):
    base = tmp_path.resolve().as_posix()
    store = stored(f"{base}/Rock/a.mp3", f"{base}/Rock and Roll/b.mp3", f"{base}/Rock and Roll/c.mp3")

    counts = store.count_tracks_containing_paths([f"{base}/Rock", f"{base}/Rock and Roll/"])

    assert [c["trackcount"] for c in counts] == [1, 2]
    assert [c["path"] for c in counts] == [f"{base}/Rock", f"{base}/Rock and Roll/"]


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_root_reached_through_a_symlink_is_counted(stored, tmp_path):
    real = tmp_path / "data" / "Music"
    real.mkdir(parents=True)
    link = tmp_path / "Music"
    link.symlink_to(real, target_is_directory=True)
    store = stored(f"{real.resolve().as_posix()}/Album/01.mp3")

    (count,) = store.count_tracks_containing_paths([str(link)])

    assert count == {"path": str(link), "trackcount": 1}


def test_a_folder_with_nothing_in_it_counts_zero(stored, tmp_path):
    base = tmp_path.resolve().as_posix()
    store = stored(f"{base}/A/1.mp3")

    assert [c["trackcount"] for c in store.count_tracks_containing_paths([f"{base}/Z"])] == [0]


def _track(title, artists):
    return SimpleNamespace(title=title, artists=artists, albumartists=artists, album="A", albumhash="a")


def test_sorting_by_artist_survives_a_track_without_one():
    from aivinnet.lib.sortlib import sort_tracks

    tracks = [_track("b", [{"name": "Zed"}]), _track("a", []), _track("c", [{"name": "Ann"}])]

    assert [t.title for t in sort_tracks(tracks, "artists")] == ["a", "c", "b"]


@pytest.mark.parametrize("key", ["no_such_field", "genres", "config", "__init__"])
def test_a_sort_key_the_view_does_not_offer_keeps_the_order(key):
    """Unknown was an AttributeError; a list, dict or method field a TypeError in `sorted`."""
    from aivinnet.lib.sortlib import sort_tracks

    tracks = [_track("b", []), _track("a", [])]
    for t in tracks:
        t.genres, t.config = [{"name": "x"}], {"k": 1}

    assert sort_tracks(tracks, key) == tracks


@pytest.mark.parametrize("reverse", [False, True])
def test_tracks_without_a_value_sort_last_either_way(reverse):
    from aivinnet.lib.sortlib import sort_tracks

    tracks = [_track("a", []), _track("b", []), _track("c", [])]
    for t, bitrate in zip(tracks, [None, 128, 320], strict=True):
        t.bitrate = bitrate

    assert [t.title for t in sort_tracks(tracks, "bitrate", reverse)][-1] == "a"


def test_sorting_folders_by_date_survives_a_folder_that_is_gone(tmp_path):
    from aivinnet.lib.sortlib import sort_folders

    here = tmp_path / "here"
    here.mkdir()
    folders = [SimpleNamespace(path=str(tmp_path / "gone"), name="gone"), SimpleNamespace(path=str(here), name="here")]

    assert [f.name for f in sort_folders(folders, "lastmod", reverse=True)] == ["here", "gone"]


def test_two_albums_of_the_same_name_stay_apart_when_sorted_by_disc():
    from aivinnet.lib.sortlib import sort_tracks

    def t(title, albumhash, track):
        return SimpleNamespace(title=title, album="Greatest Hits", albumhash=albumhash, disc=1, track=track)

    tracks = [t("x1", "x", 1), t("y1", "y", 1), t("x2", "x", 2), t("y2", "y", 2)]

    assert [tr.albumhash for tr in sort_tracks(tracks, "disc")] == ["x", "x", "y", "y"]


def test_a_folder_sorted_by_artist_answers_with_a_track_that_has_none(api_client, monkeypatch, tmp_path):
    """The real request cycle: this was a 500 for the whole folder."""
    from aivinnet.api import folder as folder_api
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.store.folder import FolderStore
    from aivinnet.store.tracks import TrackGroup, TrackStore

    album = tmp_path / "Album"
    album.mkdir()
    tracks = []
    for n, artists in enumerate(["Zed", ";", "Ann"], start=1):  # ";" splits to no artist at all
        path = album / f"0{n} Song.mp3"
        path.write_bytes(b"x")
        row = {
            "id": n,
            "album": "Album",
            "albumartists": "Various",
            "albumhash": "albumhash0000000",
            "artists": artists,
            "bitrate": 320,
            "copyright": "",
            "date": 0,
            "disc": 1,
            "duration": 100,
            "filepath": path.resolve().as_posix(),
            "folder": album.resolve().as_posix(),
            "genres": None,
            "last_mod": 1_790_000_000 + n,
            "title": f"Song {n}",
            "track": n,
            "trackhash": "",
            "extra": {},
            "lastplayed": 0,
            "playcount": 0,
            "playduration": 0,
        }
        tracks.append(track_to_dataclass(row, UserConfig()))

    assert tracks[1].artists == []
    monkeypatch.setattr(folder_api, "UserConfig", lambda: SimpleNamespace(rootDirs=[str(tmp_path)]))
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in tracks})
    monkeypatch.setattr(FolderStore, "map", {t.filepath: t.trackhash for t in tracks})
    monkeypatch.setattr(FolderStore, "filepaths", SortedSet(t.filepath for t in tracks))
    api = api_client("aivinnet.api.folder")

    res = api.post("/folder", json={"folder": str(album), "sorttracksby": "artists"})

    assert res.status_code == 200
    assert [t["title"] for t in res.get_json()["tracks"]] == ["Song 2", "Song 3", "Song 1"]
