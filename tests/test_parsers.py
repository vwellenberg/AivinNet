"""Tests for swingmusic.utils.parsers."""

from swingmusic.utils.parsers import (
    clean_title,
    get_base_album_title,
    parse_feat_from_title,
    remove_prod,
    split_artists,
)


class TestSplitArtists:
    def test_basic_separator(self, config):
        assert split_artists("Beatles; Queen", config) == ["Beatles", "Queen"]

    def test_multiple_separators(self, config):
        result = split_artists("Beatles; Queen & Rolling Stones / ABBA", config)
        assert result == ["Beatles", "Queen", "Rolling Stones", "ABBA"]

    def test_comma_splitting(self, config):
        result = split_artists("Beatles, Queen; Rolling Stones", config)
        assert result == ["Beatles", "Queen", "Rolling Stones"]

    def test_ignore_list_preserves_special_artists(self, config):
        result = split_artists("Beatles; AC/DC; Queen", config)
        assert result == ["Beatles", "AC/DC", "Queen"]

    def test_ignore_list_with_comma_and_ampersand(self, config):
        result = split_artists("Beatles; Earth, Wind & Fire; Queen", config)
        assert result == ["Beatles", "Earth, Wind & Fire", "Queen"]

    def test_ignore_list_case_insensitive(self, config):
        result = split_artists("Beatles; ac/dc", config)
        assert result == ["Beatles", "ac/dc"]

    def test_empty_string(self, config):
        assert split_artists("", config) == []

    def test_only_separators(self, config):
        assert split_artists(";;;", config) == []

    def test_whitespace_handling(self, config):
        result = split_artists("  Beatles  ;  Queen  ", config)
        assert result == ["Beatles", "Queen"]

    def test_single_artist(self, config):
        assert split_artists("Beatles", config) == ["Beatles"]

    def test_no_ignore_list(self, config_no_ignore):
        result = split_artists("AC/DC; Queen", config_no_ignore)
        assert result == ["AC", "DC", "Queen"]

    def test_multiple_ignored_artists(self, config):
        # Two separate ignore-list entries preserved within the same string.
        result = split_artists("AC/DC; Earth, Wind & Fire; Queen", config)
        assert result == ["AC/DC", "Earth, Wind & Fire", "Queen"]

    def test_ignore_list_at_start(self, config):
        result = split_artists("AC/DC; Beatles", config)
        assert result == ["AC/DC", "Beatles"]

    def test_ignore_list_at_end(self, config):
        result = split_artists("Beatles; AC/DC", config)
        assert result == ["Beatles", "AC/DC"]

    def test_ignore_list_multiword_case_insensitive(self, config_multiword_ignore):
        # Ignore entry is lowercase and multi-word; the input differs in case.
        # The original input casing must be preserved in the output.
        result = split_artists("Bob marley & The wailers; Beatles", config_multiword_ignore)
        assert result == ["Bob marley & The wailers", "Beatles"]


class TestRemoveProd:
    def test_no_prod(self):
        assert remove_prod("Song Title") == "Song Title"

    def test_prod_in_parentheses(self):
        assert remove_prod("Song (Prod. by Someone)") == "Song"

    def test_prod_in_brackets(self):
        assert remove_prod("Song [Prod. Someone]") == "Song"

    def test_prod_without_brackets(self):
        assert remove_prod("Song Prod. Someone") == "Song"

    def test_case_insensitive(self):
        assert remove_prod("Song (PROD. Someone)") == "Song"


class TestParseFeatFromTitle:
    def test_feat_in_parentheses(self, config):
        artists, title = parse_feat_from_title("Song (feat. Artist)", config)
        assert artists == ["Artist"]
        assert title.strip() == "Song"

    def test_ft_in_parentheses(self, config):
        artists, title = parse_feat_from_title("Song (ft. Artist)", config)
        assert artists == ["Artist"]
        assert title.strip() == "Song"

    def test_featuring_in_brackets(self, config):
        artists, title = parse_feat_from_title("Song [featuring Artist]", config)
        assert artists == ["Artist"]
        assert title.strip() == "Song"

    def test_with_keyword(self, config):
        artists, title = parse_feat_from_title("Song (with Artist)", config)
        assert artists == ["Artist"]
        assert title.strip() == "Song"

    def test_multiple_featured_artists(self, config):
        artists, title = parse_feat_from_title("Song (feat. Artist1 & Artist2)", config)
        assert artists == ["Artist1", "Artist2"]
        assert title.strip() == "Song"

    def test_no_featured_artists(self, config):
        artists, title = parse_feat_from_title("Normal Song Title", config)
        assert artists == []
        assert title == "Normal Song Title"

    def test_preserves_non_feat_parentheses(self, config):
        artists, title = parse_feat_from_title("Song (Deluxe Edition)", config)
        assert artists == []
        assert title == "Song (Deluxe Edition)"


class TestGetBaseAlbumTitle:
    def test_deluxe_edition(self):
        title, removed = get_base_album_title("Album (Deluxe Edition)")
        assert title == "Album"
        assert removed is not None

    def test_remastered(self):
        title, removed = get_base_album_title("Album [Remastered]")
        assert title == "Album"
        assert removed is not None

    def test_no_version_info(self):
        title, removed = get_base_album_title("Normal Album")
        assert title == "Normal Album"
        assert removed is None

    def test_super_deluxe(self):
        title, removed = get_base_album_title("Album (Super Deluxe)")
        assert title == "Album"
        assert removed is not None


class TestCleanTitle:
    def test_no_remaster(self):
        assert clean_title("Song Title") == "Song Title"

    def test_remaster_in_parentheses(self):
        result = clean_title("Song Title (2021 Remaster)")
        assert result == "Song Title"

    def test_remaster_in_brackets(self):
        result = clean_title("Song Title [Remastered 2020]")
        assert result == "Song Title"

    def test_remaster_with_hyphen(self):
        result = clean_title("Song Title - Remastered 2021")
        assert result == "Song Title"

    def test_preserves_non_remaster_info(self):
        assert clean_title("Song Title (Live)") == "Song Title (Live)"
