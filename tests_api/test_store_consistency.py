"""The library in RAM is swapped, never shown half-built; edits keep artists and covers right (#296).

A rescan emptied the track store and refilled it in place. For as long as that
took, every request saw part of the library — and "Remove missing tracks" on a
playlist took every not-yet-loaded track for an orphan and deleted it.
"""

from types import SimpleNamespace

import pytest
from test_track_edit_db_lock import library  # noqa: F401  (fixture, tests_api is on sys.path)


def _track(trackhash, filepath=None, **extra):
    return SimpleNamespace(trackhash=trackhash, filepath=filepath or f"/music/{trackhash}.mp3", bitrate=320, **extra)


@pytest.fixture()
def stores(monkeypatch):
    import aivinnet.store.tracks as tracks_module
    from aivinnet.store.tracks import TrackGroup, TrackStore

    old = {"old1": TrackGroup([_track("old1")]), "old2": TrackGroup([_track("old2")])}
    monkeypatch.setattr(TrackStore, "trackhashmap", old)
    return SimpleNamespace(module=tracks_module, store=TrackStore, old=old)


def test_a_rescan_shows_the_old_library_until_the_new_one_is_complete(stores, monkeypatch):
    seen_during_load = []

    def get_all():
        for i in range(3):
            seen_during_load.append(stores.store.trackhashmap)
            yield _track(f"new{i}")

    monkeypatch.setattr(stores.module.TrackTable, "get_all", get_all)

    stores.store.load_all_tracks("k1")

    assert all(seen is stores.old for seen in seen_during_load), "a request saw a half-built library"
    assert sorted(stores.store.trackhashmap) == ["new0", "new1", "new2"]


def test_a_load_overtaken_by_a_newer_one_leaves_the_library_alone(stores, monkeypatch):
    def get_all():
        yield _track("new0")
        stores.module.TRACKS_LOAD_KEY = "a newer load"
        yield _track("new1")

    monkeypatch.setattr(stores.module.TrackTable, "get_all", get_all)

    stores.store.load_all_tracks("k1")

    assert stores.store.trackhashmap is stores.old


def test_the_folder_index_is_swapped_and_forgets_removed_files(monkeypatch):
    import aivinnet.store.folder as folder_module
    from aivinnet.store.folder import FolderStore

    monkeypatch.setattr(FolderStore, "filepaths", {"/music/gone.mp3", "/music/kept.mp3"})
    monkeypatch.setattr(FolderStore, "map", {"/music/gone.mp3": "g", "/music/kept.mp3": "k"})
    during = []

    def get_all():
        during.append(set(FolderStore.filepaths))
        yield _track("k", "/music/kept.mp3")
        during.append(set(FolderStore.filepaths))
        yield _track("n", "/music/new.mp3")

    monkeypatch.setattr(folder_module.TrackStore, "get_flat_list", get_all)

    FolderStore.load_filepaths()

    assert all(paths == {"/music/gone.mp3", "/music/kept.mp3"} for paths in during)
    assert FolderStore.filepaths == {"/music/kept.mp3", "/music/new.mp3"}
    assert FolderStore.map == {"/music/kept.mp3": "k", "/music/new.mp3": "n"}


def test_the_swapped_folder_index_can_still_be_counted(monkeypatch):
    """
    The folder counts bisect the index, so it must stay SORTED and indexable.

    ⚠️ Equality alone cannot see it: a SortedSet compares equal to a plain set,
    and the test above stayed green while 2026.10.2 swapped in a plain set —
    and every Home with a folder row answered 500.
    """
    import aivinnet.store.folder as folder_module
    from aivinnet.store.folder import FolderStore

    monkeypatch.setattr(FolderStore, "filepaths", folder_module.SortedSet())
    monkeypatch.setattr(FolderStore, "map", {})
    monkeypatch.setattr(
        folder_module.TrackStore,
        "get_flat_list",
        lambda: iter(
            [_track("b", "/music/Rock/b.mp3"), _track("a", "/music/Rock/a.mp3"), _track("c", "/music/Pop/c.mp3")]
        ),
    )

    FolderStore.load_filepaths()

    assert FolderStore.count_tracks_containing_paths(["/music/Rock", "/music/Pop", "/music"]) == [
        {"path": "/music/Rock", "trackcount": 2},
        {"path": "/music/Pop", "trackcount": 1},
        {"path": "/music", "trackcount": 3},
    ]


def test_the_artist_map_is_not_emptied_while_it_is_rebuilt(monkeypatch):
    import aivinnet.store.artists as artists_module
    from aivinnet.store.artists import ArtistStore

    old = {"a1": object(), "a2": object()}
    monkeypatch.setattr(ArtistStore, "artistmap", old)
    sizes = []
    monkeypatch.setattr(
        artists_module, "create_artists", lambda _hashes: sizes.append(len(ArtistStore.artistmap)) or []
    )

    ArtistStore.load_artists("k1")

    assert sizes == [2], "artist pages were empty during the rebuild"


def test_an_album_artist_only_entry_follows_the_edit(monkeypatch):
    """
    Various Artists names no track as a performer, but its album list must still move.

    Rebuilt like the full build at startup builds it (#391): before, the
    one-artist rebuild found no track for an album-only artist and a
    separate patch-up branch guessed the entry instead.
    """
    from test_store_assumptions import _track as real_track

    from aivinnet.lib import track_edit
    from aivinnet.lib.tagger import create_artists
    from aivinnet.store.artists import ArtistMapEntry, ArtistStore
    from aivinnet.store.tracks import TrackGroup, TrackStore

    tracks = [
        real_track(1, "Ann", "Various Artists", "Fixed"),
        real_track(2, "Bob", "Various Artists", "Fixed"),
        real_track(3, "Cid", "Various Artists", "Other"),
    ]
    monkeypatch.setattr(TrackStore, "trackhashmap", {t.trackhash: TrackGroup([t]) for t in tracks})
    full = next(r for r in create_artists([]) if r[0].name == "Various Artists")
    va = full[0].artisthash
    entry = ArtistMapEntry(artist=SimpleNamespace(), albumhashes={"retired"}, trackhashes={"t9"})
    monkeypatch.setattr(ArtistStore, "artistmap", {va: entry})

    track_edit._reconcile_artist(va)

    assert ArtistStore.artistmap[va].albumhashes == full[2] == {t.albumhash for t in tracks}
    assert ArtistStore.artistmap[va].trackhashes == full[1]


def test_a_tag_edit_does_not_replace_the_albums_cover(library, monkeypatch):  # noqa: F811
    """A chosen cover survives: the edit changed tags, not the picture in the file."""
    from aivinnet.lib import track_edit

    path, _hashes = library
    calls = []
    monkeypatch.setattr(track_edit, "extract_thumb", lambda *a, **k: calls.append(k))

    track_edit.edit_track_tags_by_filepath(path, {"title": "New"})

    assert calls and all(k.get("overwrite") is False for k in calls)
