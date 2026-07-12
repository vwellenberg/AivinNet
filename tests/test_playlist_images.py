"""Unit tests for playlist cover image selection (get_first_4_images).

The function feeds the client's playlist collage: it must return the first 4
albums with *distinct* covers (albumhash-dedupe plus content-hash dedupe for
byte-identical cover files) and pad with duplicates when fewer exist, so the
client can tell a real 4-cover set apart from a padded one.
"""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

# Mock heavy / unavailable deps just long enough to import playlistlib (the
# fast CI lane installs only a handful of packages). We track which mocks we
# add and remove them again right after the import so we don't shadow real
# modules for test files collected after this one.
_added = []
for _mod in [
    "PIL",
    "swingmusic.settings",
    "swingmusic.models.track",
    "swingmusic.store.albums",
    "swingmusic.store.tracks",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()
        _added.append(_mod)

from swingmusic.lib import playlistlib  # noqa: E402

# playlistlib has bound its references; drop the temporary mocks so they don't
# leak into later-collected test modules.
for _mod in _added:
    sys.modules.pop(_mod, None)


def _track(albumhash: str):
    """Minimal Track stand-in (the function only reads .albumhash)."""
    return SimpleNamespace(albumhash=albumhash)


def _album(albumhash: str):
    return SimpleNamespace(albumhash=albumhash, image=f"{albumhash}.webp", color=f"color-{albumhash}")


def _album_with_pathhash(albumhash: str):
    """Album.image as the real model builds it: with a cache-busting query suffix."""
    return SimpleNamespace(
        albumhash=albumhash,
        image=f"{albumhash}.webp?pathhash=ph-{albumhash}",
        color=f"color-{albumhash}",
    )


class _FakeAlbumStore:
    def __init__(self, albums):
        self._map = {a.albumhash: a for a in albums}

    def get_albums_by_hashes(self, hashes):
        return [self._map[h] for h in hashes if h in self._map]


def _setup(monkeypatch, tmp_path, albums, covers: dict[str, bytes]):
    """
    Installs a fake AlbumStore and a thumbnail dir at tmp_path. `covers` maps
    albumhash -> thumbnail bytes; albums without an entry have no file on disk.
    """
    playlistlib._file_md5.cache_clear()
    monkeypatch.setattr(playlistlib, "AlbumStore", _FakeAlbumStore(albums))
    monkeypatch.setattr(playlistlib.settings, "Paths", lambda: SimpleNamespace(sm_thumb_path=tmp_path))

    for albumhash, data in covers.items():
        (tmp_path / f"{albumhash}.webp").write_bytes(data)


def _image_names(images):
    return [i["image"] for i in images]


def test_four_distinct_albums_in_playlist_order(monkeypatch, tmp_path):
    albums = [_album(h) for h in ["a", "b", "c", "d"]]
    covers = {h: f"bytes-{h}".encode() for h in ["a", "b", "c", "d"]}
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "b", "c", "d"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == ["a.webp", "b.webp", "c.webp", "d.webp"]
    assert images[0]["color"] == "color-a"


def test_dedupes_by_albumhash(monkeypatch, tmp_path):
    albums = [_album(h) for h in ["a", "b", "c", "d", "e"]]
    covers = {h: f"bytes-{h}".encode() for h in ["a", "b", "c", "d", "e"]}
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "a", "b", "a", "b", "c", "d", "e"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == ["a.webp", "b.webp", "c.webp", "d.webp"]


def test_skips_byte_identical_cover_of_other_album(monkeypatch, tmp_path):
    # "b" is a compilation split: different albumhash, same cover bytes as "a".
    albums = [_album(h) for h in ["a", "b", "c", "d", "e"]]
    covers = {
        "a": b"same-artwork",
        "b": b"same-artwork",
        "c": b"c-artwork",
        "d": b"d-artwork",
        "e": b"e-artwork",
    }
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "b", "c", "d", "e"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == ["a.webp", "c.webp", "d.webp", "e.webp"]


def test_pads_when_fewer_than_four_distinct_covers(monkeypatch, tmp_path):
    # Only 2 distinct covers ("a"=="b" bytes) -> padded to 4 with duplicates,
    # so the client's distinctness check fails and it falls back to a single
    # cover.
    albums = [_album(h) for h in ["a", "b", "c"]]
    covers = {"a": b"same", "b": b"same", "c": b"other"}
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "b", "c"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert len(images) == 4
    assert set(_image_names(images)) == {"a.webp", "c.webp"}


def test_single_album_is_padded_to_four(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [_album("a")], {"a": b"x"})

    images = playlistlib.get_first_4_images(tracks=[_track("a"), _track("a")])

    assert _image_names(images) == ["a.webp"] * 4


def test_empty_tracklist_returns_empty(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [], {})

    assert playlistlib.get_first_4_images(tracks=[]) == []


def test_all_covers_missing_falls_back_to_first_album(monkeypatch, tmp_path):
    # No cover files on disk at all: coverless albums can't render a tile, so
    # instead of a placeholder collage the first album is returned padded
    # (single-cover fallback, same shape as before).
    albums = [_album(h) for h in ["a", "b", "c", "d"]]
    _setup(monkeypatch, tmp_path, albums, covers={})

    tracks = [_track(h) for h in ["a", "b", "c", "d"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == ["a.webp"] * 4


def test_coverless_albums_do_not_count_as_collage_candidates(monkeypatch, tmp_path):
    # "b" and "d" have no cover file: they must not fill collage slots with
    # placeholder tiles. Later albums with real covers take their place.
    albums = [_album(h) for h in ["a", "b", "c", "d", "e", "f"]]
    covers = {h: f"bytes-{h}".encode() for h in ["a", "c", "e", "f"]}
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "b", "c", "d", "e", "f"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == ["a.webp", "c.webp", "e.webp", "f.webp"]


def test_mixed_coverless_pads_with_real_covers_only(monkeypatch, tmp_path):
    # Only one album has a real cover: result is that cover padded to 4, so
    # the client renders the real cover instead of a placeholder-heavy collage.
    albums = [_album(h) for h in ["a", "b", "c", "d"]]
    covers = {"c": b"real-artwork"}
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "b", "c", "d"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == ["c.webp"] * 4


def test_image_query_suffix_is_stripped_for_file_lookup(monkeypatch, tmp_path):
    # Album.image is "<albumhash>.webp?pathhash=..." (models.album appends a
    # cache-busting suffix); the file on disk is plain "<albumhash>.webp".
    # The suffix must not make albums look coverless, and content dedupe must
    # still work ("a" and "b" share bytes).
    albums = [_album_with_pathhash(h) for h in ["a", "b", "c", "d"]]
    covers = {"a": b"same", "b": b"same", "c": b"c-art", "d": b"d-art"}
    _setup(monkeypatch, tmp_path, albums, covers)

    tracks = [_track(h) for h in ["a", "b", "c", "d"]]
    images = playlistlib.get_first_4_images(tracks=tracks)

    assert _image_names(images) == [
        "a.webp?pathhash=ph-a",
        "c.webp?pathhash=ph-c",
        "d.webp?pathhash=ph-d",
        "a.webp?pathhash=ph-a",
    ]


def test_content_key_tracks_file_changes(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [], {"a": b"one"})

    key_before = playlistlib.get_cover_content_key("a.webp")
    (tmp_path / "a.webp").write_bytes(b"two-different-size")
    key_after = playlistlib.get_cover_content_key("a.webp")

    assert key_before != key_after
    assert key_before.startswith("md5:")


def test_missing_file_key_is_none(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [], {})

    assert playlistlib.get_cover_content_key("nope.webp") is None
