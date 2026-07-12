"""
Tests for playlistlib.cleanup_playlist_images.

Regression: the original implementation compared the Path object against a
set of filename strings (never a member) and had the keep/delete branches
inverted — it deleted every LINKED playlist image (and its thumbnail) while
keeping the orphans it was supposed to remove.
"""

from types import SimpleNamespace

from swingmusic.lib import playlistlib


def _fake_playlist(image: str | None):
    return SimpleNamespace(image=image)


def test_cleanup_deletes_only_orphans(tmp_path, monkeypatch):
    # Linked image + its thumbnail, plus an orphaned pair.
    (tmp_path / "1abcde.webp").write_bytes(b"x")
    (tmp_path / "thumb_1abcde.webp").write_bytes(b"x")
    (tmp_path / "orphan.webp").write_bytes(b"x")
    (tmp_path / "thumb_orphan.webp").write_bytes(b"x")

    monkeypatch.setattr(playlistlib.settings, "Paths", lambda: SimpleNamespace(playlist_img_path=tmp_path))

    from swingmusic.db.userdata import PlaylistTable

    seen_kwargs = {}

    def fake_get_all(current_user=True):
        seen_kwargs["current_user"] = current_user
        return iter([_fake_playlist("1abcde.webp"), _fake_playlist(None), _fake_playlist("None")])

    monkeypatch.setattr(PlaylistTable, "get_all", fake_get_all)

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

    from swingmusic.db.userdata import PlaylistTable

    monkeypatch.setattr(
        PlaylistTable,
        "get_all",
        lambda current_user=True: iter([_fake_playlist("a.webp"), _fake_playlist("b.gif")]),
    )

    playlistlib.cleanup_playlist_images()

    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == ["a.webp", "b.gif", "thumb_a.webp", "thumb_b.gif"]
