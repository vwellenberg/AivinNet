"""
"Recently added" on Home: a folder that is neither an album nor an artist.

Reported: one new song in the library root put the root itself on Home as
"NEW MUSIC · music · 12837 Tracks". The folder's group holds every file that
ever landed in it, so its newest file made all of them look new.
"""

from pathlib import Path
from types import SimpleNamespace

from aivinnet.lib.home.recent_folders import (
    NEW_TOLERANCE_SECONDS,
    fresh_batch,
    root_prefixes,
    show_as_folder,
)

NOW = 1_790_000_000
YEAR = 365 * 86_400
MUSIC = Path("/music").resolve().as_posix()


def track(added: float, name: str = "t") -> SimpleNamespace:
    return SimpleNamespace(added=added, trackhash=name)


def test_only_what_came_in_with_the_newest_file_is_fresh():
    old = [track(NOW - YEAR - n, f"old{n}") for n in range(50)]
    new = track(NOW, "new")

    assert fresh_batch([*old, new]) == [new]


def test_files_copied_within_a_day_belong_to_the_same_batch():
    batch = [track(NOW), track(NOW - NEW_TOLERANCE_SECONDS + 1), track(NOW - NEW_TOLERANCE_SECONDS)]
    older = track(NOW - NEW_TOLERANCE_SECONDS - 1)

    assert fresh_batch([*batch, older]) == batch
    assert fresh_batch([]) == []


def test_a_library_root_is_never_a_folder_card():
    roots = root_prefixes([MUSIC], Path.home())
    batch = [track(NOW - n) for n in range(10)]

    # Stored folders end in "/" (models/track.py); either spelling is the root.
    assert not show_as_folder(MUSIC + "/", batch, roots)
    assert not show_as_folder(MUSIC, batch, roots)
    assert show_as_folder(MUSIC + "/Sampler/", batch, roots)


def test_a_handful_of_new_files_are_tracks_not_a_folder():
    roots = root_prefixes([MUSIC], Path.home())

    assert not show_as_folder(MUSIC + "/Misc/", [track(NOW), track(NOW - 1)], roots)
    assert show_as_folder(MUSIC + "/Misc/", [track(NOW), track(NOW - 1), track(NOW - 2)], roots)


def test_home_as_a_root_is_the_users_home(tmp_path):
    assert root_prefixes(["$home"], tmp_path) == {tmp_path.resolve().as_posix() + "/"}
