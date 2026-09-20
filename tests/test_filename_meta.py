"""Reading a track number and a title out of a file name.

This is the source that repairs the album the feature was asked for: "The
Guild 2", 94 files tagged `track 1` with the number as their title, real titles
only in the file names — and zero MusicBrainz candidates under either name. So
the cases below are mostly taken straight off that album and its neighbours,
not invented.
"""

import pytest

from aivinnet.lib.filename_meta import looks_like_placeholder, parse


class TestRealLibraryNames:
    @pytest.mark.parametrize(
        "name,number,title",
        [
            # Straight off the reported album.
            ("/m/The Guild 2/68. Night Woods1.mp3", 68, "Night Woods1"),
            ("/m/The Guild 2/02. Game Won.mp3", 2, "Game Won"),
            # A double space after the separator, also from that album.
            ("/m/The Guild 2/40.  Background Landscape4.mp3", 40, "Background Landscape4"),
            # The other separators this library uses.
            ("/m/A/01 - Opening.flac", 1, "Opening"),
            ("/m/A/03_Closing.ogg", 3, "Closing"),
            ("/m/A/7) Encore.m4a", 7, "Encore"),
            ("/m/A/Artist - 05 - Middle.mp3", 5, "Middle"),
        ],
    )
    def test_it_reads_them(self, name, number, title):
        assert parse(name) == (number, title)


class TestWhatItRefusesToGuess:
    def test_a_year_is_not_a_track_number(self):
        # The separator is required for exactly this: "1984" followed by a
        # space is a title, not track 1.
        assert parse("/m/A/1984 Suite.mp3") == (None, "1984 Suite")

    def test_a_placeholder_in_the_file_name_is_not_a_title(self):
        # ⚠️ The placeholder sits at the END here. A check anchored at the
        # start misses this shape, which is the common one (53 files in the
        # tag-repair round).
        assert parse("/m/A/Genesis - 03 - Track 3.ogg") == (3, None)

    def test_a_bare_placeholder_is_not_a_title_either(self):
        assert parse("/m/A/05. Track 05.mp3") == (5, None)

    def test_a_name_that_says_nothing_says_nothing(self):
        assert parse("/m/A/.mp3") == (None, None)

    def test_an_empty_path_is_not_a_crash(self):
        assert parse("") == (None, None)

    def test_a_plain_title_keeps_its_number_empty(self):
        assert parse("/m/A/Just A Song.mp3") == (None, "Just A Song")


class TestPlaceholders:
    @pytest.mark.parametrize("value", ["Track 07", "track7", "Titel 3", "Spur 12", "audiotrack01", "Track"])
    def test_recognised(self, value):
        assert looks_like_placeholder(value) is True

    @pytest.mark.parametrize("value", ["Soundtrack", "Tracks of My Tears", "Backtrack", "", "Night Woods1"])
    def test_not_recognised(self, value):
        # "Soundtrack" and "Backtrack" contain the word and are perfectly good
        # titles — a substring check would have eaten both.
        assert looks_like_placeholder(value) is False
