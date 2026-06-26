"""Tests for folder-search index derivation (issue #64)."""

import sys
from unittest.mock import MagicMock

# Importing swingmusic.store.folder pulls in SQLAlchemy-backed modules that are
# not installed in the test environment (and would hit a metaclass conflict
# under mocked SQLAlchemy). derive_folder_paths is pure (pathlib only), so stub
# those heavy modules out before importing it.
for mod_name in [
    "sortedcontainers",
    "swingmusic.db",
    "swingmusic.db.libdata",
    "swingmusic.store.tracks",
]:
    sys.modules.setdefault(mod_name, MagicMock())

from swingmusic.store.folder import derive_folder_paths  # noqa: E402

FILEPATHS = [
    "/music/Pink Floyd/The Wall/01 - In the Flesh.flac",
    "/music/Pink Floyd/The Wall/02 - The Thin Ice.flac",
    "/music/Pink Floyd/Animals/01 - Pigs.flac",
    "/music/Radiohead/OK Computer/01 - Airbag.flac",
]


def test_includes_leaf_and_intermediate_dirs():
    """Both album folders and their parent artist folders are indexed (recursive)."""
    result = derive_folder_paths(FILEPATHS, ["/music"])
    paths = {p for _, p in result}

    assert "/music/Pink Floyd/The Wall/" in paths
    assert "/music/Pink Floyd/Animals/" in paths
    assert "/music/Pink Floyd/" in paths  # intermediate (artist) dir
    assert "/music/Radiohead/OK Computer/" in paths
    assert "/music/Radiohead/" in paths


def test_excludes_the_root_dir_itself():
    result = derive_folder_paths(FILEPATHS, ["/music"])
    paths = {p for _, p in result}
    names = {n for n, _ in result}

    assert "/music/" not in paths
    assert "music" not in names


def test_folder_names_match_basename():
    result = derive_folder_paths(FILEPATHS, ["/music"])
    by_path = {p: n for n, p in result}

    assert by_path["/music/Pink Floyd/The Wall/"] == "The Wall"
    assert by_path["/music/Pink Floyd/"] == "Pink Floyd"


def test_excludes_dirs_outside_root_dirs():
    result = derive_folder_paths(["/other/Some Album/track.flac"], ["/music"])
    assert result == []


def test_dedupes_shared_directories():
    result = derive_folder_paths(FILEPATHS, ["/music"])
    paths = [p for _, p in result]

    assert paths.count("/music/Pink Floyd/") == 1
    assert paths.count("/music/Pink Floyd/The Wall/") == 1


def test_supports_multiple_roots():
    filepaths = [
        "/musicA/Album One/track.flac",
        "/musicB/Album Two/track.flac",
    ]
    result = derive_folder_paths(filepaths, ["/musicA", "/musicB"])
    paths = {p for _, p in result}

    assert "/musicA/Album One/" in paths
    assert "/musicB/Album Two/" in paths
