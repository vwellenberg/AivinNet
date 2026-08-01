"""Tests for the folder-based cover fallback in swingmusic.lib.taglib."""

import sys
from unittest.mock import MagicMock

# Mock heavy dependencies that are not installed in the lightweight test
# environment before importing swingmusic modules (see test_album_model.py).
for mod_name in ["PIL", "tinytag"]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

from swingmusic.lib.taglib import find_folder_cover  # noqa: E402


def _write(path, content=b"IMG"):
    path.write_bytes(content)


class TestFindFolderCover:
    def test_empty_folder_returns_none(self, tmp_path):
        assert find_folder_cover(str(tmp_path)) is None

    def test_nonexistent_folder_returns_none(self, tmp_path):
        assert find_folder_cover(str(tmp_path / "nope")) is None

    def test_folder_without_images_returns_none(self, tmp_path):
        _write(tmp_path / "track.mp3", b"audio")
        (tmp_path / "notes.txt").write_text("hi")
        assert find_folder_cover(str(tmp_path)) is None

    def test_finds_cover_jpg(self, tmp_path):
        _write(tmp_path / "cover.jpg", b"COVER")
        assert find_folder_cover(str(tmp_path)) == b"COVER"

    def test_finds_folder_jpg(self, tmp_path):
        _write(tmp_path / "folder.jpg", b"FOLDER")
        assert find_folder_cover(str(tmp_path)) == b"FOLDER"

    def test_case_insensitive(self, tmp_path):
        _write(tmp_path / "Cover.JPG", b"MIXED")
        assert find_folder_cover(str(tmp_path)) == b"MIXED"

    def test_cover_beats_folder(self, tmp_path):
        _write(tmp_path / "cover.jpg", b"COVER")
        _write(tmp_path / "folder.jpg", b"FOLDER")
        assert find_folder_cover(str(tmp_path)) == b"COVER"

    def test_jpg_beats_png_for_same_basename(self, tmp_path):
        _write(tmp_path / "cover.png", b"PNG")
        _write(tmp_path / "cover.jpg", b"JPG")
        assert find_folder_cover(str(tmp_path)) == b"JPG"

    def test_lone_image_used_as_fallback(self, tmp_path):
        _write(tmp_path / "scan001.png", b"LONE")
        assert find_folder_cover(str(tmp_path)) == b"LONE"

    def test_multiple_unnamed_images_no_match(self, tmp_path):
        _write(tmp_path / "scan001.png", b"A")
        _write(tmp_path / "scan002.png", b"B")
        assert find_folder_cover(str(tmp_path)) is None

    def test_named_cover_wins_over_unnamed_images(self, tmp_path):
        _write(tmp_path / "booklet01.jpg", b"BOOK1")
        _write(tmp_path / "booklet02.jpg", b"BOOK2")
        _write(tmp_path / "front.jpg", b"FRONT")
        assert find_folder_cover(str(tmp_path)) == b"FRONT"

    def test_empty_named_cover_yields_none(self, tmp_path):
        _write(tmp_path / "cover.jpg", b"")
        assert find_folder_cover(str(tmp_path)) is None
