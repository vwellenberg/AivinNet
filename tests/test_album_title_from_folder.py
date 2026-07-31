"""
Album titles for untagged files, and the trackhash change that comes with them.

A file with no album tag used to take its album TITLE from the parsed filename —
the track's own title. Hidden while every untagged file shared one album;
conspicuous once `albumhash_collapse` grouped them by folder, leaving hundreds of
correct albums each named after whichever track happened to be first.

The title is load-bearing in a way the album hash is not: `trackhash` is derived
from `(artists, album, title)`. So the interesting property here is not "the
title is nicer" — it is that the rename is a **rehash**, and every playlist,
favourite and scrobble points at trackhashes.
"""

import pytest

from swingmusic.lib.albumhash import album_hash, album_title
from swingmusic.utils.hashing import create_hash


def scanner_trackhash(artists: str, album: str, title: str) -> str:
    return create_hash(artists, album, title)


class TestTitle:
    def test_a_present_tag_always_wins(self):
        """
        The folder is a FALLBACK. A tagged file must keep its title, or every
        tagged album in every library gets renamed.
        """
        assert album_title("Permanent Shade of Blue", "/music/roachford") == "Permanent Shade of Blue"

    def test_an_untagged_file_takes_its_folder_name(self):
        assert album_title(None, "/mnt/music/700-Games/Hearthstone") == "Hearthstone"
        assert album_title("", "/mnt/music/700-Games/Victoria 3") == "Victoria 3"

    def test_a_trailing_separator_does_not_swallow_the_name(self):
        assert album_title(None, "/mnt/music/700-Games/Kenshi/") == "Kenshi"
        assert album_title(None, "C:\\music\\Kenshi\\") == "Kenshi"

    def test_nothing_usable_returns_none(self):
        """
        The caller keeps its own "Unknown" fallback; this must not invent an
        empty-string album title that would then be hashed.
        """
        assert album_title(None, "") is None
        assert album_title(None, "/") is None


class TestRehash:
    """
    The rename changes identity. These pin down when, and when not.
    """

    def test_renaming_the_album_changes_the_trackhash(self):
        old = scanner_trackhash("Unknown", "Ice Troll Caves", "Ice Troll Caves")
        new = scanner_trackhash("Unknown", "Old School Runescape", "Ice Troll Caves")

        assert old != new

    def test_two_tracks_in_one_folder_stay_distinct(self):
        """
        The album part is now shared across the folder, so the TITLE has to keep
        them apart — otherwise a rename would merge tracks into one identity and
        a playlist would lose entries.
        """
        a = scanner_trackhash("Unknown", "Hearthstone", "BOM Varden")
        b = scanner_trackhash("Unknown", "Hearthstone", "Sludge Belcher")

        assert a != b

    def test_the_same_title_in_two_folders_stays_distinct(self):
        a = scanner_trackhash("Unknown", "Shogun", "Battle")
        b = scanner_trackhash("Unknown", "Rome", "Battle")

        assert a != b

    @pytest.mark.parametrize("tag", ["Blood Sugar Sex Magik", "Ünïcödé", "  spaced  "])
    def test_a_tagged_track_keeps_its_identity(self, tag):
        """
        The single most important invariant: nothing about a properly tagged
        file may move, or the migration takes the whole library with it.
        """
        before = scanner_trackhash("RHCP", tag, "Give It Away")
        after = scanner_trackhash("RHCP", album_title(tag, "/any/folder"), "Give It Away")

        assert before == after


class TestIdempotence:
    def test_a_renamed_row_no_longer_qualifies(self):
        """
        The migration selects rows whose album differs from the folder's name.
        After the rename they are equal, so a second run finds nothing.
        """
        folder = "/mnt/music/700-Games/Kenshi"
        renamed = album_title(None, folder)

        assert renamed == album_title(None, folder)
        assert renamed == "Kenshi"

    def test_the_folder_signature_survives_the_rename(self):
        """
        Rows are found by their FOLDER-derived album hash — the mark left by
        `albumhash_collapse`. Renaming the title must not disturb it, or the
        two migrations would fight over the same rows.
        """
        folder, artists = "/mnt/music/700-Games/Kenshi", "Unknown"
        before = album_hash(None, folder, artists)

        # The rename touches `album` and `trackhash`, never `albumhash`.
        assert album_hash(None, folder, artists) == before
