"""One order for a folder: the view, "Play" on its card and "save as playlist" (#391).

The view sorted its files by the float mtime it read from disk, "Play"
(`/folder/tracks/all`) and the playlist by the stored `last_mod`, and a tie
fell back to directory order in the first and to the store's hash order in the
other two. An album unpacked from a zip or copied with `rsync -t` is one big
tie: the queue and the new playlist did not follow what the user saw.
"""

import os

import pytest

T0 = 1_790_000_000


@pytest.fixture()
def folder(tmp_path, monkeypatch):
    """Three files with one stored mtime, a different order on disk, and a third in the store."""
    from aivinnet.config import UserConfig
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.store.folder import FolderStore
    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    monkeypatch.setattr(TrackStore, "_by_filepath", {})
    monkeypatch.setattr(FolderStore, "map", {})
    monkeypatch.setattr(FolderStore, "filepaths", type(FolderStore.filepaths)())

    album = tmp_path / "Album"
    album.mkdir()
    # Disk order: c oldest, then a, then b. Store order: b, c, a.
    for n, (name, disk_age) in enumerate([("b", 1), ("c", 3), ("a", 2)]):
        path = album / f"{name}.mp3"
        path.write_bytes(b"")
        os.utime(path, (T0 - disk_age, T0 - disk_age))
        track = track_to_dataclass(
            {
                "id": n,
                "album": "Album",
                "albumartists": "Ann",
                "albumhash": "a1b2c3d4e5f60718",
                "artists": "Ann",
                "bitrate": 320,
                "copyright": "",
                "date": T0,
                "disc": 1,
                "duration": 100,
                "filepath": path.as_posix(),
                "folder": album.as_posix(),
                "genres": None,
                "last_mod": T0,  # the tie: one second for the whole album
                "title": f"Song {name}",
                "track": n + 1,
                "trackhash": "",
                "extra": {},
                "lastplayed": 0,
                "playcount": 0,
                "playduration": 0,
            },
            UserConfig(),
        )
        TrackStore.add_track(track)
        FolderStore.index_file(track.filepath, track.trackhash)

    return album


def _names(paths):
    return [os.path.basename(p) for p in paths]


def test_view_play_and_playlist_list_a_folder_alike(folder, api_client, monkeypatch):
    import aivinnet.api.folder as folder_api
    from aivinnet.api.playlist import get_path_trackhashes
    from aivinnet.lib.folderslib import get_files_and_dirs
    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr(folder_api, "is_path_within_root_dirs", lambda *a, **k: True)

    view = get_files_and_dirs(
        folder,
        start=0,
        limit=-1,
        tracksortby="default",
        foldersortby="default",
        tracksort_reverse=False,
        foldersort_reverse=False,
        tracks_only=True,
    )
    res = api_client("aivinnet.api.folder").get("/folder/tracks/all", query_string={"path": str(folder)})
    assert res.status_code == 200, res.get_data(as_text=True)
    by_hash = {t.trackhash: t.filepath for t in TrackStore.get_flat_list()}
    playlist = [by_hash[h] for h in get_path_trackhashes(folder.as_posix(), "default", False)]

    expected = ["a.mp3", "b.mp3", "c.mp3"]
    assert _names(t["filepath"] for t in view["tracks"]) == expected
    assert _names(t["filepath"] for t in res.get_json()["tracks"]) == expected
    assert _names(playlist) == expected
