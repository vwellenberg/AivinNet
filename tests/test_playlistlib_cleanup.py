"""
Tests for playlistlib.cleanup_playlist_images.

Regression: the original implementation compared the Path object against a
set of filename strings (never a member) and had the keep/delete branches
inverted — it deleted every LINKED playlist image (and its thumbnail) while
keeping the orphans it was supposed to remove.

INFO: cleanup_playlist_images imports PlaylistTable lazily, so instead of
importing the real swingmusic.db.userdata (whose sqlalchemy/store import
chain clashes with the MagicMock stubs other test modules leave in
sys.modules during a shared session), these tests install a fake module via
monkeypatch.setitem — automatically restored after each test.
"""

import sys
from types import SimpleNamespace

from swingmusic.lib import playlistlib


def _fake_playlist(image: str | None):
    return SimpleNamespace(image=image)


def _install_fake_userdata(monkeypatch, playlists: list, seen_kwargs: dict | None = None):
    def fake_get_all(current_user=True):
        if seen_kwargs is not None:
            seen_kwargs["current_user"] = current_user
        return iter(playlists)

    fake_module = SimpleNamespace(PlaylistTable=SimpleNamespace(get_all=fake_get_all))
    monkeypatch.setitem(sys.modules, "swingmusic.db.userdata", fake_module)


def test_cleanup_deletes_only_orphans(tmp_path, monkeypatch):
    # Linked image + its thumbnail, plus an orphaned pair.
    (tmp_path / "1abcde.webp").write_bytes(b"x")
    (tmp_path / "thumb_1abcde.webp").write_bytes(b"x")
    (tmp_path / "orphan.webp").write_bytes(b"x")
    (tmp_path / "thumb_orphan.webp").write_bytes(b"x")

    monkeypatch.setattr(playlistlib.settings, "Paths", lambda: SimpleNamespace(playlist_img_path=tmp_path))

    seen_kwargs: dict = {}
    _install_fake_userdata(
        monkeypatch,
        [_fake_playlist("1abcde.webp"), _fake_playlist(None), _fake_playlist("None")],
        seen_kwargs,
    )

    playlistlib.cleanup_playlist_images()

    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == ["1abcde.webp", "thumb_1abcde.webp"]

    # The image folder is shared across users: the linked set must be
    # built from ALL users' playlists.
    assert seen_kwargs == {"current_user": False}


def test_cleanup_keeps_all_linked_images(tmp_path, monkeypatch):
    (tmp_path / "a.webp").write_bytes(b"x")
    (tmp_path / "thumb_a.webp").write_bytes(b"x")
    (tmp_path / "b.gif").write_bytes(b"x")
    (tmp_path / "thumb_b.gif").write_bytes(b"x")

    monkeypatch.setattr(playlistlib.settings, "Paths", lambda: SimpleNamespace(playlist_img_path=tmp_path))

    _install_fake_userdata(monkeypatch, [_fake_playlist("a.webp"), _fake_playlist("b.gif")])

    playlistlib.cleanup_playlist_images()

    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == ["a.webp", "b.gif", "thumb_a.webp", "thumb_b.gif"]
