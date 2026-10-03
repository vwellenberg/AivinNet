"""PUT /track/<hash>/tags on a trackhash that two files share.

Live on 2026-10-02: a folder held every song twice, `X.mp3` next to `X.wav`,
with identical tags — and so one trackhash, which is derived from
title/album/artists and nothing else. A batch sent 149 PUTs, one per file, and
got 149 times 200. The MP3s were never touched: the endpoint resolved the hash
with `get_best()` (highest bitrate), so both PUTs of a pair rewrote the WAV.

The endpoint now refuses to guess: an ambiguous hash without a `filepath` is a
409 that names the candidates, and a `filepath` picks exactly that file. The
tag reader and writer are stubbed by file content; the endpoint, the edit, the
database and the store are real.
"""

from pathlib import Path

import pytest


def _tags(filepath: str, title: str, bitrate: int) -> dict:
    return {
        "album": "Deep Sea Dreams",
        "albumartists": "Dream.Corp",
        "albumhash": "albumhash0000000",
        "artists": "Dream.Corp",
        "bitrate": bitrate,
        "copyright": "",
        "date": 1735689600,
        "disc": 1,
        "duration": 148,
        "filepath": filepath,
        "folder": filepath.rsplit("/", 1)[0],
        "genres": None,
        "last_mod": 1768785726,
        "title": title,
        "track": 1,
        "trackhash": "stale-db-hash000",
        "extra": {},
    }


BITRATE = {".mp3": 320, ".wav": 1411}


@pytest.fixture()
def pair(api_client, playlist_db, tmp_path, monkeypatch):
    """`Blue Moon.mp3` and `Blue Moon.wav`: same tags, one trackhash."""
    from aivinnet.config import UserConfig
    from aivinnet.db import create_all_tables
    from aivinnet.db.libdata import TrackTable
    from aivinnet.db.utils import track_to_dataclass
    from aivinnet.lib import track_edit
    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})

    paths = {}
    for ext in BITRATE:
        f = tmp_path / f"Blue Moon{ext}"
        f.write_bytes(b"ORIGINAL")
        paths[ext] = f.as_posix()

    def fake_get_tags(filepath, config):
        edited = Path(filepath).read_bytes() == b"EDITED"
        return _tags(filepath, "Blue Moon (Edit)" if edited else "Blue Moon", BITRATE[Path(filepath).suffix])

    monkeypatch.setattr(track_edit, "get_tags", fake_get_tags)
    monkeypatch.setattr(
        track_edit.tag_writer, "write_tags", lambda filepath, fields: Path(filepath).write_bytes(b"EDITED")
    )
    monkeypatch.setattr(track_edit, "extract_thumb", lambda *a, **k: None)
    monkeypatch.setattr(track_edit, "_reconcile_album", lambda albumhash: None)
    monkeypatch.setattr(track_edit, "_reconcile_artist", lambda artisthash: None)
    monkeypatch.setattr(track_edit.FolderStore, "index_file", lambda *a: None)
    monkeypatch.setattr(TrackStore, "trackhashmap", {})

    create_all_tables()
    TrackTable.remove_tracks_by_filepaths(set(paths.values()))
    for i, (ext, path) in enumerate(paths.items(), start=1):
        tags = _tags(path, "Blue Moon", BITRATE[ext])
        TrackTable.insert_one(tags)
        TrackStore.add_track(
            track_to_dataclass({**tags, "id": i, "lastplayed": 0, "playcount": 0, "playduration": 0}, UserConfig())
        )

    (trackhash,) = TrackStore.trackhashmap.keys()
    yield api_client("aivinnet.api.track"), trackhash, paths

    TrackTable.remove_tracks_by_filepaths(set(paths.values()))


def _content(paths):
    return {ext: Path(p).read_bytes() for ext, p in paths.items()}


def test_an_ambiguous_hash_without_a_path_is_refused_and_writes_nothing(pair):
    api, trackhash, paths = pair

    res = api.put(f"/track/{trackhash}/tags", json={"albumartists": ["Dream.Corp"]})

    assert res.status_code == 409
    assert sorted(res.json["filepaths"]) == sorted(paths.values())
    assert _content(paths) == {".mp3": b"ORIGINAL", ".wav": b"ORIGINAL"}


def test_one_put_per_file_edits_each_file_once(pair):
    """The live batch: one PUT per file, the same hash twice. Both files must change."""
    api, trackhash, paths = pair

    for path in paths.values():
        res = api.put(f"/track/{trackhash}/tags", json={"albumartists": ["Dream.Corp"], "filepath": path})
        assert res.status_code == 200
        # The response names the file that was written, not one that merely shares the hash.
        assert res.json["track"]["filepath"] == path

    assert _content(paths) == {".mp3": b"EDITED", ".wav": b"EDITED"}


def test_the_path_picks_the_file_even_when_the_other_has_the_higher_bitrate(pair):
    api, trackhash, paths = pair

    res = api.put(f"/track/{trackhash}/tags", json={"title": "Blue Moon (Edit)", "filepath": paths[".mp3"]})

    assert res.status_code == 200
    assert _content(paths) == {".mp3": b"EDITED", ".wav": b"ORIGINAL"}


def test_a_path_that_does_not_carry_the_hash_is_not_edited(pair, tmp_path):
    api, trackhash, paths = pair
    stranger = (tmp_path / "Other.mp3").as_posix()

    res = api.put(f"/track/{trackhash}/tags", json={"title": "x", "filepath": stranger})

    assert res.status_code == 404
    assert _content(paths) == {".mp3": b"ORIGINAL", ".wav": b"ORIGINAL"}


def test_a_unique_hash_still_needs_no_path(pair):
    """The single-track editor of older clients sends no path; one file is unambiguous."""
    api, trackhash, paths = pair
    first = api.put(f"/track/{trackhash}/tags", json={"title": "Blue Moon (Edit)", "filepath": paths[".mp3"]})
    new_hash = first.json["track"]["trackhash"]
    assert new_hash != trackhash

    res = api.put(f"/track/{new_hash}/tags", json={"track": 2})

    assert res.status_code == 200
    assert res.json["track"]["filepath"] == paths[".mp3"]
