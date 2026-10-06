"""GET /folder/tracks/all: "Play" on a folder card, without freezing the server (#295).

It loaded the whole track table, stat-ed every file below the folder and
serialised all of them before keeping 300 — for a root folder that is the
whole library, on the single request thread. And its SQL matched any
substring, so /music/Rock also played /music/Rock and Roll.
"""

import pathlib
from types import SimpleNamespace

import pytest


@pytest.fixture()
def folder_api(api_client, monkeypatch):
    import aivinnet.api.folder as folder_api
    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr(folder_api, "is_path_within_root_dirs", lambda *a, **k: True)
    monkeypatch.setattr(folder_api, "serialize_track", lambda t: {"filepath": t.filepath})
    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    monkeypatch.setattr(TrackStore, "_by_filepath", {})

    stats = []

    class CountingPath(type(pathlib.Path())):
        def exists(self, *a, **k):
            stats.append(str(self))
            return True

    monkeypatch.setattr(folder_api, "Path", CountingPath)

    def add(filepath: str, last_mod: int):
        TrackStore.add_track(
            SimpleNamespace(trackhash=f"h{len(TrackStore.trackhashmap)}", filepath=filepath, last_mod=last_mod)
        )

    return SimpleNamespace(api=api_client("aivinnet.api.folder"), add=add, stats=stats)


def _paths(res):
    assert res.status_code == 200, res.get_data(as_text=True)
    return [t["filepath"] for t in res.get_json()["tracks"]]


def test_a_folder_plays_only_itself_and_what_is_below_it(folder_api, tmp_path):
    # Native paths, as the indexer stores them.
    a = str(tmp_path / "Rock" / "a.mp3")
    b = str(tmp_path / "Rock" / "Live" / "b.mp3")
    folder_api.add(a, 1)
    folder_api.add(b, 2)
    folder_api.add(str(tmp_path / "Rock and Roll" / "c.mp3"), 3)

    paths = _paths(folder_api.api.get("/folder/tracks/all", query_string={"path": str(tmp_path / "Rock")}))

    assert paths == [a, b]


def test_the_order_is_the_folder_views_modification_time(folder_api, tmp_path):
    newest, oldest, middle = (str(tmp_path / f"{n}.mp3") for n in ("newest", "oldest", "middle"))
    folder_api.add(newest, 300)
    folder_api.add(oldest, 100)
    folder_api.add(middle, 200)

    paths = _paths(folder_api.api.get("/folder/tracks/all", query_string={"path": str(tmp_path)}))

    assert paths == [oldest, middle, newest]


def test_a_huge_folder_is_capped_before_any_file_is_touched(folder_api, tmp_path):
    for i in range(1000):
        folder_api.add(str(tmp_path / f"{i:04}.mp3"), i)

    paths = _paths(folder_api.api.get("/folder/tracks/all", query_string={"path": str(tmp_path)}))

    assert len(paths) == 300
    assert paths[0] == str(tmp_path / "0000.mp3")
    # One stat per returned track — not one per track below the folder.
    assert len([s for s in folder_api.stats if s.endswith(".mp3")]) == 300
