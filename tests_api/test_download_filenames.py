"""A downloaded file should say what it is.

The server sent the name from disk, and in a real library those carry no
context: `swamp.mp3`, `Drum Loop 03.mp3`, `Main Theme (Piano).mp3`. Ten of them
in a phone's Downloads folder and none says what it belongs to — while the tags
knew all along (`Robert Euvino — Stronghold — Drum Loop 03`).
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from aivinnet.api.download import _unique, download_filename


def track(**kw):
    base = {"albumartists": "Phil Collins", "album": "Face Value", "title": "I Missed Again", "track": 7}
    base.update(kw)
    return SimpleNamespace(**base)


ORIGINAL = Path("/music/whatever/07 track.mp3")


class TestNaming:
    def test_all_three_parts_are_used(self):
        assert download_filename(track(), ORIGINAL) == "Phil Collins - Face Value - 07 I Missed Again.mp3"

    def test_the_extension_comes_from_the_real_file(self):
        assert download_filename(track(), Path("/m/x.flac")).endswith(".flac")

    @pytest.mark.parametrize("unknown", ["Unknown", "unknown", "  UNKNOWN  ", "", "Various Artists"])
    def test_an_uninformative_artist_is_left_out_not_printed(self, unknown):
        """
        Plenty of game soundtracks have no album artist, and this library is
        full of them. "Unknown - …" is noise, not information.
        """
        assert download_filename(track(albumartists=unknown), ORIGINAL) == "Face Value - 07 I Missed Again.mp3"

    def test_a_missing_album_is_left_out(self):
        assert download_filename(track(album=""), ORIGINAL) == "Phil Collins - 07 I Missed Again.mp3"

    def test_no_track_number_means_no_number(self):
        assert download_filename(track(track=0), ORIGINAL) == "Phil Collins - Face Value - I Missed Again.mp3"

    def test_without_a_title_the_original_name_is_kept(self):
        """A worse name is still better than an empty one."""
        assert download_filename(track(title=""), ORIGINAL) == "07 track.mp3"

    def test_the_list_of_dicts_shape_is_understood_too(self):
        """
        The RAM store hands out a plain string, the model declares a list of
        dicts. Guessing one wrong would put "[{'name':" into a filename.
        """
        t = track(albumartists=[{"name": "Koji Kondo"}])

        assert download_filename(t, ORIGINAL).startswith("Koji Kondo - ")


class TestSafety:
    @pytest.mark.parametrize("bad", ["a/b", "a\b", "a:b", "a?b", "a*b", 'a"b', "a<b", "a>b", "a|b"])
    def test_characters_that_break_filesystems_are_replaced(self, bad):
        name = download_filename(track(title=bad), ORIGINAL)

        assert not any(c in name[:-4] for c in r'<>:"/\|?*')

    def test_a_control_character_does_not_survive(self):
        assert "\n" not in download_filename(track(title="a\nb"), ORIGINAL)

    def test_a_very_long_name_is_capped(self):
        name = download_filename(track(title="x" * 400), ORIGINAL)

        assert len(name) <= 160

    def test_a_trailing_dot_is_stripped(self):
        """Windows silently drops trailing dots, which breaks the round-trip."""
        name = download_filename(track(artists=None, albumartists="", album="", title="Intro."), ORIGINAL)

        assert not name[: -len(".mp3")].endswith(".")


class TestArchiveEntriesStayDistinct:
    def test_a_repeat_gets_a_suffix(self):
        """Two identical entry names in a zip unpack to one file."""
        taken: set[str] = set()

        first = _unique("Song.mp3", taken)
        second = _unique("Song.mp3", taken)

        assert first == "Song.mp3"
        assert second == "Song (2).mp3"

    def test_the_suffix_keeps_counting(self):
        taken: set[str] = set()

        names = [_unique("Song.mp3", taken) for _ in range(3)]

        assert names == ["Song.mp3", "Song (2).mp3", "Song (3).mp3"]
