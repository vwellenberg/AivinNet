"""Tests for tag_writer's pure helpers (no mutagen, no file I/O).

``tag_writer`` imports mutagen lazily, so these helpers import cleanly under the
CI test job (which does not install mutagen).
"""

import pytest

from swingmusic.lib.tag_writer import TagWriteError, _easy_value, _validate


class TestEasyValue:
    def test_single_text_field_is_stripped(self):
        assert _easy_value("title", "  Hello World  ") == ["Hello World"]

    def test_track_number_is_stringified(self):
        assert _easy_value("track", 7) == ["7"]

    def test_artists_joined_with_comma(self):
        # split_artists always splits on commas, so a comma-join round-trips.
        assert _easy_value("artists", ["A", "B", "C"]) == ["A, B, C"]

    def test_artists_are_stripped_and_blanks_dropped(self):
        assert _easy_value("artists", [" A ", "", "  ", "B"]) == ["A, B"]

    def test_album_artists_joined(self):
        assert _easy_value("albumartists", ["X", "Y"]) == ["X, Y"]

    def test_single_artist_has_no_separator(self):
        assert _easy_value("artists", ["Solo"]) == ["Solo"]


class TestValidate:
    def test_passes_with_valid_required_fields(self):
        _validate({"title": "T", "album": "A", "artists": ["X"]})  # must not raise

    def test_ignores_absent_required_fields(self):
        _validate({"track": 3})  # title/album/artists absent -> ok

    def test_empty_title_is_rejected(self):
        with pytest.raises(TagWriteError):
            _validate({"title": "   "})

    def test_empty_album_is_rejected(self):
        with pytest.raises(TagWriteError):
            _validate({"album": ""})

    def test_empty_artists_list_is_rejected(self):
        with pytest.raises(TagWriteError):
            _validate({"artists": []})

    def test_all_blank_artists_are_rejected(self):
        with pytest.raises(TagWriteError):
            _validate({"artists": ["  ", ""]})

    def test_artists_with_one_valid_entry_passes(self):
        _validate({"artists": ["", "Real"]})  # must not raise
