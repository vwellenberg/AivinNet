"""Tests for aivinnet.utils.parsers."""

from aivinnet.utils.parsers import (
    clean_title,
    get_base_album_title,
    parse_feat_from_title,
    remove_prod,
    split_artists,
    strip_artist_credit,
    strip_artist_credit_until_2026_10,
    strip_artist_credits,
    strip_track_number,
    tag_int,
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


class TestTagInt:
    """`Track.extra` holds raw tag values, and their shape depends on the reader."""

    def test_tinytag_2_list_of_strings(self):
        # What tinytag 2's as_dict() stores for "track 1/12" — the value that
        # 500'd the album page.
        assert tag_int(["12"], 0) == 12

    def test_tinytag_1_plain_number(self):
        assert tag_int(12, 0) == 12

    def test_plain_string(self):
        assert tag_int(" 12 ", 0) == 12

    def test_n_of_total_form(self):
        assert tag_int("3/12", 0) == 3

    def test_missing_or_empty_falls_back(self):
        for value in (None, [], "", [""], "abc", ["x"], "²", 1.5, {"a": 1}):
            assert tag_int(value, 7) == 7

    def test_bool_is_not_a_number(self):
        assert tag_int(True, 7) == 7


class TestStripTrackNumber:
    """A number in front of a title goes only with a second witness."""

    def test_the_tracks_own_number_goes(self):
        # The report: "049 Saint Wenceslaus Theme" never showed up for "saint".
        assert strip_track_number("049 Saint Wenceslaus Theme", 49, 1, "/m/a.mp3") == "Saint Wenceslaus Theme"

    def test_a_disc_and_track_prefix_goes(self):
        title = "6-001 Fistcuffs 1 (Extended Version)"
        assert strip_track_number(title, 1, 6, "/m/a.mp3") == "Fistcuffs 1 (Extended Version)"

    def test_punctuation_after_the_number_counts(self):
        assert strip_track_number("7. Intro", 7, 1, "/m/a.mp3") == "Intro"
        assert strip_track_number("01 - Intro", 1, 1, "/m/a.mp3") == "Intro"

    def test_a_file_named_with_the_same_number_is_a_witness(self):
        # No track tag: the file reads as track 1, and its name carries the number.
        path = "/m/KCD2/049 Saint Wenceslaus Theme.mp3"
        assert strip_track_number("049 Saint Wenceslaus Theme", 1, 1, path) == "Saint Wenceslaus Theme"

    def test_an_unpadded_number_needs_punctuation_even_when_the_file_name_agrees(self):
        # The file is named after the song, so it repeats the title and proves
        # nothing: "3 Libras" is track 3 of its album, "10 Years" track 10.
        assert strip_track_number("3 Libras", 3, 1, "/m/3 Libras.mp3") == "3 Libras"
        assert strip_track_number("10 Years", 10, 1, "/m/10 Years.mp3") == "10 Years"
        assert strip_track_number("14 swamp camp", 14, 1, "/g/14 swamp camp.mp3.mp3") == "14 swamp camp"
        assert strip_track_number("14. swamp camp", 14, 1, "/g/14. swamp camp.mp3") == "swamp camp"

    def test_a_number_inside_a_name_stays(self):
        # Hyphenated and decimal names: the number is not in front of words.
        assert strip_track_number("24-7", 24, 1, "/m/a.mp3") == "24-7"
        assert strip_track_number("7-11", 7, 1, "/m/a.mp3") == "7-11"
        assert strip_track_number("1-2-3", 2, 1, "/m/a.mp3") == "1-2-3"
        assert strip_track_number("1.5 Degrees", 1, 1, "/m/a.mp3") == "1.5 Degrees"
        assert strip_track_number("1-Up", 1, 1, "/m/a.mp3") == "1-Up"
        # A padded number with no space before the words is still a number in front.
        assert strip_track_number("01-intro", 1, 1, "/m/01-intro.mp3") == "intro"

    def test_a_number_that_belongs_to_the_name_stays(self):
        assert strip_track_number("007 Theme", 12, 1, "/m/007 Theme.mp3") == "007 Theme"
        assert strip_track_number("007 Theme", 12, 1, "/m/12 - 007 Theme.mp3") == "007 Theme"
        assert strip_track_number("7 Seconds", 7, 1, "/m/Youssou - Seven.mp3") == "7 Seconds"
        assert strip_track_number("24-7 Love", 3, 1, "/m/24-7 Love.mp3") == "24-7 Love"
        assert strip_track_number("99 Luftballons", 99, 1, "/m/a.mp3") == "99 Luftballons"
        assert strip_track_number("2001 A Space Odyssey", 5, 1, "/m/2001 A Space Odyssey.mp3") == (
            "2001 A Space Odyssey"
        )

    def test_a_padded_number_without_a_witness_stays(self):
        assert strip_track_number("049 Saint Wenceslaus Theme", 1, 1, "/m/Saint.mp3") == ("049 Saint Wenceslaus Theme")

    def test_nothing_but_a_number_stays(self):
        assert strip_track_number("1979", 1, 1, "/m/1979.mp3") == "1979"
        assert strip_track_number("01 -", 1, 1, "/m/a.mp3") == "01 -"
        assert strip_track_number("", 1, 1, "") == ""


class TestStripArtistCredit:
    def test_the_role_goes(self):
        assert strip_artist_credit("Composed by Adam Sporka") == "Adam Sporka"
        assert strip_artist_credit("composed by  Adam Sporka") == "Adam Sporka"
        assert strip_artist_credit("Music by Jan Valta") == "Jan Valta"
        assert strip_artist_credit("Music composed by Inon Zur") == "Inon Zur"
        assert strip_artist_credit("Original Score by Hans Zimmer") == "Hans Zimmer"
        assert strip_artist_credit("Komponiert von Klaus Doldinger") == "Klaus Doldinger"

    def test_a_name_stays(self):
        assert strip_artist_credit("Adam Sporka") == "Adam Sporka"
        assert strip_artist_credit("Written by Wolves") == "Written by Wolves"  # a band
        assert strip_artist_credit("Bypass") == "Bypass"

    def test_a_role_without_a_name_stays(self):
        assert strip_artist_credit("Composed by") == "Composed by"

    def test_the_lyricist_loses_the_role_too(self):
        # KCD2: "Composed by Jan Valta; Lyrics by John Comer" left "Lyrics by
        # John Comer" standing as an artist of its own.
        assert strip_artist_credit("Lyrics by John Comer") == "John Comer"
        assert strip_artist_credit("Words by Tim Rice") == "Tim Rice"
        assert strip_artist_credit("Lyrics Born") == "Lyrics Born"  # a rapper

    def test_roles_joined_into_one_credit_go_together(self):
        assert strip_artist_credit("Music and Lyrics by Jan Valta") == "Jan Valta"
        assert strip_artist_credit("Words & Music by Jan Valta") == "Jan Valta"
        assert strip_artist_credit("Composed, Arranged by Inon Zur") == "Inon Zur"

    def test_the_rule_until_2026_10_is_kept_as_it_was(self):
        # Rebuilds the hashes tracks had under it; it must not learn anything new.
        assert strip_artist_credit_until_2026_10("Composed by Adam Sporka") == "Adam Sporka"
        assert strip_artist_credit_until_2026_10("Lyrics by John Comer") == "Lyrics by John Comer"


class TestStripArtistCredits:
    def test_a_credit_the_separators_split_comes_back_as_one(self):
        # "Composed & Lyrics by Jan Valta": "&" splits before any credit is seen.
        assert strip_artist_credits(["Composed", "Lyrics by Jan Valta"]) == ["Jan Valta"]
        assert strip_artist_credits(["Music", "Lyrics by Adam Sporka", "Band"]) == ["Adam Sporka", "Band"]

    def test_each_name_loses_its_own_credit(self):
        assert strip_artist_credits(["Composed by Jan Valta", "Lyrics by John Comer"]) == ["Jan Valta", "John Comer"]
        assert strip_artist_credits(["Composed by Jan Valta", "Panychida"]) == ["Jan Valta", "Panychida"]

    def test_a_role_word_without_a_credit_after_it_stays(self):
        # Without a credited name to belong to, it may be a name after all.
        assert strip_artist_credits(["Music", "Someone"]) == ["Music", "Someone"]
        assert strip_artist_credits(["Lyrics"]) == ["Lyrics"]
        assert strip_artist_credits(["Someone", "Composed"]) == ["Someone", "Composed"]
