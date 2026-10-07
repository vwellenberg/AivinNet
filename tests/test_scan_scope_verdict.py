"""What a rescan may do with a track row, given what the scan saw (#391).

The end-to-end cases against a real database are in
`tests_api/test_scan_scope.py`; these pin the decision itself.
"""

import os

import pytest

from aivinnet.utils.filesystem import ScanScope, dir_prefix


def test_a_prefix_ends_in_exactly_one_slash(tmp_path):
    assert dir_prefix(tmp_path) == tmp_path.resolve().as_posix() + "/"
    assert dir_prefix(f"{tmp_path}/") == tmp_path.resolve().as_posix() + "/"


def test_the_filesystem_root_is_a_prefix_too():
    assert dir_prefix("/") == "/"


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_root_behind_a_symlink_becomes_its_target(tmp_path):
    real = tmp_path / "data"
    real.mkdir()
    (tmp_path / "link").symlink_to(real, target_is_directory=True)

    assert dir_prefix(tmp_path / "link") == real.resolve().as_posix() + "/"


def test_a_row_under_a_root_that_answered_is_checked():
    scope = ScanScope(roots={"/music/": True})

    assert scope.verdict("/music/Artist/Album/01.mp3") == "check"


def test_a_row_under_a_root_that_did_not_answer_is_kept():
    scope = ScanScope(roots={"/music/": True, "/nas/": False})

    assert scope.verdict("/nas/Artist/01.mp3") == "keep"
    assert scope.unanswered == ["/nas/"]


def test_the_most_specific_root_decides():
    """A disk mounted inside another root is offline while its parent answers."""
    scope = ScanScope(roots={"/music/": True, "/music/usb/": False})

    assert scope.verdict("/music/usb/Album/01.mp3") == "keep"
    assert scope.verdict("/music/Album/01.mp3") == "check"


def test_a_row_outside_every_root_is_dropped_once_all_answered():
    scope = ScanScope(roots={"/music/": True})

    assert scope.verdict("/old/Album/01.mp3") == "drop"


def test_a_row_outside_every_root_waits_while_one_is_offline():
    scope = ScanScope(roots={"/music/": True, "/nas/": False})

    assert scope.verdict("/old/Album/01.mp3") == "keep"


def test_a_sibling_with_the_same_prefix_is_outside():
    scope = ScanScope(roots={"/music/Rock/": True})

    assert scope.verdict("/music/Rock and Roll/01.mp3") == "drop"


def test_an_excluded_folder_is_dropped_even_under_an_offline_root():
    """The exclusion is the owner's explicit word; it needs no stat."""
    scope = ScanScope(roots={"/nas/": False}, excluded=("/nas/Podcasts/",))

    assert scope.verdict("/nas/Podcasts/ep1.mp3") == "drop"
    assert scope.verdict("/nas/Album/01.mp3") == "keep"


def test_from_scan_marks_roots_that_found_nothing(tmp_path):
    here = tmp_path / "here"
    here.mkdir()
    scope = ScanScope.from_scan(
        {str(here): [f"{here.resolve().as_posix()}/a.mp3"], str(tmp_path / "gone"): []},
        exclude=["", str(here / "Podcasts")],
    )

    assert scope.roots == {dir_prefix(here): True, dir_prefix(tmp_path / "gone"): False}
    assert scope.excluded == (dir_prefix(here / "Podcasts"),)


def test_from_scan_expands_a_home_relative_exclusion(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))

    scope = ScanScope.from_scan({}, exclude=["~/Podcasts"])

    assert scope.excluded == (dir_prefix(tmp_path / "Podcasts"),)


def test_a_file_the_scan_found_is_checked_wherever_it_lies():
    """A symlinked folder can lead outside every root; the scan still found it."""
    scope = ScanScope(roots={"/music/": True}, found=frozenset({"/data/extra/01.mp3"}))

    assert scope.verdict("/data/extra/01.mp3") == "check"
    assert scope.verdict("/data/extra/02.mp3") == "drop"


def test_a_row_under_a_folder_that_could_not_be_listed_is_kept():
    scope = ScanScope(roots={"/music/": True}, unreadable=("/music/NFS/",))

    assert scope.verdict("/music/NFS/Album/01.mp3") == "keep"
    assert scope.verdict("/music/Local/01.mp3") == "check"
    assert scope.unanswered == ["/music/NFS/"]


def test_from_scan_collects_found_files_and_unreadable_folders(tmp_path):
    here = tmp_path.resolve().as_posix()
    scope = ScanScope.from_scan({here: [f"{here}/a.mp3"]}, unreadable={f"{here}/NFS"})

    assert scope.found == {f"{here}/a.mp3"}
    assert scope.unreadable == (f"{here}/NFS/",)
