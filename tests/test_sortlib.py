"""Tests for folder sorting."""

import sys
from unittest.mock import MagicMock

# Mock heavy dependencies before importing swingmusic modules
for mod_name in [
    "flask_jwt_extended",
    "flask",
    "flask_cors",
    "flask_compress",
    "flask_openapi3",
    "PIL",
    "colorgram",
    "tqdm",
    "tinytag",
    "psutil",
    "show_in_file_manager",
    "tabulate",
    "setproctitle",
    "locust",
    "watchdog",
    "sqlalchemy",
    "sortedcontainers",
    "ffmpeg",
    "schedule",
    "pystray",
    "rapidfuzz",
]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

from swingmusic.lib.sortlib import sort_folders  # noqa: E402
from swingmusic.models.folder import Folder  # noqa: E402


def make_folder(name: str, trackcount: int = 5) -> Folder:
    return Folder(name=name, path=f"/music/{name}", trackcount=trackcount)


class TestSortFolders:
    def test_sort_by_name(self):
        folders = [make_folder("Zeppelin"), make_folder("ABBA"), make_folder("Beatles")]
        result = sort_folders(folders, "name")
        assert [f.name for f in result] == ["ABBA", "Beatles", "Zeppelin"]

    def test_sort_by_name_case_insensitive(self):
        folders = [make_folder("zeppelin"), make_folder("ABBA"), make_folder("beatles")]
        result = sort_folders(folders, "name")
        assert [f.name for f in result] == ["ABBA", "beatles", "zeppelin"]

    def test_sort_by_name_reversed(self):
        folders = [make_folder("ABBA"), make_folder("Beatles"), make_folder("Zeppelin")]
        result = sort_folders(folders, "name", reverse=True)
        assert [f.name for f in result] == ["Zeppelin", "Beatles", "ABBA"]

    def test_sort_by_trackcount(self):
        folders = [make_folder("A", 10), make_folder("B", 3), make_folder("C", 7)]
        result = sort_folders(folders, "trackcount")
        assert [f.name for f in result] == ["B", "C", "A"]

    def test_sort_default_preserves_order(self):
        folders = [make_folder("C"), make_folder("A"), make_folder("B")]
        result = sort_folders(folders, "default")
        assert [f.name for f in result] == ["C", "A", "B"]

    def test_sort_empty_list(self):
        assert sort_folders([], "name") == []
