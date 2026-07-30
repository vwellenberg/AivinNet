"""
The album-hash collapse (vwellenberg/AivinNet-Client#255) and its repair.

A file with no album tag used to hash the EMPTY STRING as its album, so every
untagged file sharing an album artist landed in one album with one cover for all
of them. On a real library that was 4043 tracks from 208 different folders.

Two halves are tested here, because they have to agree with each other or the
repair fixes rows the scanner will re-break on the next scan:

  * the SIGNATURE — what an affected row looks like once it is in the database
    (the raw tag is gone by then; only the hash it produced survives),
  * the REGROUPING — that two folders which collapsed into one album come out
    as two, and that a folder is stable across the files inside it.
"""

import pytest

from swingmusic.lib.albumhash import album_hash, broken_album_hash
from swingmusic.utils.hashing import create_hash


# The real rule, not a copy of it. Both live in `lib/albumhash.py` precisely so
# a test can reach them without importing the tag reader or the ORM — an earlier
# draft imported them from the migration module and took the whole database
# layer with it, which the unit-test job does not have.
scanner_albumhash = album_hash


class TestSignature:
    """The repair finds affected rows by re-deriving the hash they were given."""

    def test_untagged_files_collapse_without_the_fix(self):
        # The old rule, spelled out: empty tag + album artist.
        a = create_hash("", "Unknown")
        b = create_hash("", "Unknown")
        assert a == b

    def test_signature_matches_what_the_old_rule_produced(self):
        for artist in ["Unknown", "Red Hot Chili Peppers", ""]:
            assert broken_album_hash(artist) == create_hash("", artist)

    def test_signature_does_not_match_a_properly_tagged_album(self):
        """
        A tagged album must never look affected — that is what keeps the repair
        from touching rows it has no business touching.
        """
        tagged = scanner_albumhash("Blood Sugar Sex Magik", "/music/rhcp", "Red Hot Chili Peppers")
        assert tagged != broken_album_hash("Red Hot Chili Peppers")


class TestRegrouping:
    """The fix has to split the bucket, and split it along folder lines."""

    def test_two_folders_no_longer_share_an_album(self):
        artist = "Unknown"
        one = scanner_albumhash("", "/music/games/Hearthstone", artist)
        two = scanner_albumhash("", "/music/games/Victoria 3", artist)

        assert one != two
        # ...and neither is the collapsed bucket any more.
        assert one != broken_album_hash(artist)
        assert two != broken_album_hash(artist)

    def test_files_in_the_same_folder_stay_one_album(self):
        artist = "Unknown"
        folder = "/music/games/Hearthstone"

        assert scanner_albumhash("", folder, artist) == scanner_albumhash("", folder, artist)

    def test_same_folder_name_in_different_paths_stays_apart(self):
        """
        `Battle` under Shogun and `Battle` under another game are two albums.
        The full folder path is hashed, not the directory's name — a real
        library has plenty of repeated leaf names.
        """
        a = scanner_albumhash("", "/music/games/Shogun/Battle", "Unknown")
        b = scanner_albumhash("", "/music/games/Rome/Battle", "Unknown")

        assert a != b

    def test_album_artist_still_separates_within_one_folder(self):
        folder = "/music/compilations/misc"

        assert scanner_albumhash("", folder, "Artist A") != scanner_albumhash("", folder, "Artist B")

    @pytest.mark.parametrize("tag", ["Permanent Shade of Blue", "  spaced  ", "Ünïcödé"])
    def test_a_present_tag_still_wins(self, tag):
        """
        The folder is a FALLBACK. A file that has an album tag must hash exactly
        as it did before the fix, or every tagged album in every existing
        library changes identity.
        """
        assert scanner_albumhash(tag, "/any/folder", "Some Artist") == create_hash(tag, "Some Artist")


class TestIdempotence:
    """
    The repair runs on every start, so a second pass must be a no-op. It is
    driven entirely by the signature: once a row carries the folder-derived
    hash, it no longer matches.
    """

    def test_a_repaired_row_no_longer_matches_the_signature(self):
        artist = "Unknown"
        repaired = scanner_albumhash("", "/music/games/Hearthstone", artist)

        assert repaired != broken_album_hash(artist)

    def test_a_single_folder_bucket_is_left_alone(self):
        """
        If every affected track sits in ONE folder, the collapsed hash and the
        folder hash can still differ — but when they do not, the repair must
        skip the row instead of writing the same value back.
        """
        artist = "Unknown"
        folder = ""  # degenerate: no folder -> the fallback IS the empty string

        assert scanner_albumhash("", folder, artist) == broken_album_hash(artist)
