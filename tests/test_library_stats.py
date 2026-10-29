"""The library tiles on the stats page (#536): explored shares, nonstop length, formats, hi-res."""

from aivinnet.lib.library_stats import (
    HIRES_BITDEPTH,
    HIRES_SAMPLERATE,
    LibraryFile,
    explored,
    is_hires,
    library_file,
    library_totals,
)


def file(
    trackhash: str,
    albumhash: str = "album-a",
    duration: int = 200,
    bitrate: int = 320,
    format: str = "MP3",
    samplerate: int = 44100,
    bitdepth: int = 0,
) -> LibraryFile:
    return LibraryFile(trackhash, albumhash, duration, bitrate, format, samplerate, bitdepth)


# -- explored: shares of tracks and albums ----------------------------------


def test_the_track_share_is_heard_over_the_library():
    files = [file("a"), file("b"), file("c"), file("d")]

    body = explored(files, {"a", "c"})

    assert body["tracks"] == {"heard": 2, "total": 4, "share": 0.5}


def test_a_track_in_two_files_counts_once():
    # X.mp3 and X.wav share a trackhash: one track, heard or not.
    files = [file("a", format="MP3"), file("a", format="WAV"), file("b")]

    body = explored(files, {"a"})

    assert body["tracks"] == {"heard": 1, "total": 2, "share": 0.5}


def test_an_album_is_explored_once_any_of_its_tracks_is_heard():
    files = [
        file("a1", albumhash="A"),
        file("a2", albumhash="A"),
        file("b1", albumhash="B"),
        file("c1", albumhash="C"),
    ]

    body = explored(files, {"a2"})

    assert body["albums"] == {"heard": 1, "total": 3, "share": 1 / 3}


def test_hearing_tracks_no_longer_in_the_library_changes_nothing():
    body = explored([file("a")], {"a", "gone-from-library"})

    assert body["tracks"] == {"heard": 1, "total": 1, "share": 1.0}


def test_an_empty_library_has_no_share_rather_than_a_division_by_zero():
    body = explored([], {"a"})

    assert body["tracks"] == {"heard": 0, "total": 0, "share": None}
    assert body["albums"] == {"heard": 0, "total": 0, "share": None}


def test_nothing_heard_is_zero_not_none():
    body = explored([file("a"), file("b")], set())

    assert body["tracks"] == {"heard": 0, "total": 2, "share": 0.0}


# -- nonstop length ---------------------------------------------------------


def test_the_nonstop_length_is_the_sum_of_the_tracks_once_each():
    totals = library_totals([file("a", duration=200), file("b", duration=300), file("a", duration=200, format="WAV")])

    assert totals["nonstop_seconds"] == 500


def test_an_empty_library_runs_for_no_seconds():
    totals = library_totals([])

    assert totals["nonstop_seconds"] == 0
    assert totals["files"] == 0


# -- formats and mean bitrate -----------------------------------------------


def test_formats_are_shares_of_the_files_most_common_first():
    files = [file("1", format="MP3"), file("2", format="FLAC"), file("3", format="MP3"), file("4", format="MP3")]

    shares = library_totals(files)["formats"]

    assert shares == [
        {"format": "MP3", "files": 3, "share": 0.75},
        {"format": "FLAC", "files": 1, "share": 0.25},
    ]


def test_a_tie_in_formats_is_ordered_by_name():
    files = [file("1", format="OGG"), file("2", format="AAC")]

    names = [row["format"] for row in library_totals(files)["formats"]]

    assert names == ["AAC", "OGG"]


def test_the_mean_bitrate_leaves_out_files_without_one():
    # A bitrate of 0 is "unknown" (tinytag gives 0 for some formats), not a slow file.
    files = [file("1", bitrate=320), file("2", bitrate=0), file("3", bitrate=256)]

    assert library_totals(files)["mean_bitrate"] == 288


def test_the_mean_bitrate_is_none_without_any_known_bitrate():
    assert library_totals([file("1", bitrate=0)])["mean_bitrate"] is None
    assert library_totals([])["mean_bitrate"] is None


# -- hi-res -----------------------------------------------------------------


def test_a_sample_rate_of_exactly_48_khz_is_not_hi_res():
    assert is_hires(HIRES_SAMPLERATE, 0) is False
    assert is_hires(HIRES_SAMPLERATE + 1, 0) is True


def test_a_bit_depth_of_exactly_16_is_not_hi_res():
    assert is_hires(44100, HIRES_BITDEPTH) is False
    assert is_hires(44100, HIRES_BITDEPTH + 1) is True


def test_a_24_bit_file_at_cd_rate_is_hi_res():
    assert is_hires(44100, 24) is True


def test_missing_samplerate_and_bitdepth_are_never_hi_res():
    assert is_hires(0, 0) is False


def test_the_hi_res_share_counts_files_not_tracks():
    files = [
        file("a", samplerate=96000, bitdepth=24, format="FLAC"),
        file("a", samplerate=44100, format="MP3"),
        file("b", samplerate=44100, format="MP3"),
        file("c", samplerate=44100, format="MP3"),
    ]

    hires = library_totals(files)["hires"]

    assert hires == {"files": 1, "share": 0.25}


def test_the_hi_res_share_of_an_empty_library_is_none():
    assert library_totals([])["hires"] == {"files": 0, "share": None}


# -- reading a file: missing and odd tag values -----------------------------


def test_a_file_without_extra_fields_has_zero_rates_and_is_not_hi_res():
    lib = library_file("a", "A", 200, 320, "/music/x.mp3", None)

    assert (lib.samplerate, lib.bitdepth) == (0, 0)
    assert is_hires(lib.samplerate, lib.bitdepth) is False


def test_tag_values_as_lists_of_strings_are_read():
    # tinytag 2 gives fields as lists of strings; rows from both eras sit side by side.
    lib = library_file("a", "A", 200, 320, "/music/x.flac", {"samplerate": ["96000"], "bitdepth": ["24"]})

    assert (lib.samplerate, lib.bitdepth) == (96000, 24)


def test_a_garbage_tag_value_is_zero_not_a_crash():
    lib = library_file("a", "A", 200, 320, "/music/x.flac", {"samplerate": "n/a", "bitdepth": None})

    assert (lib.samplerate, lib.bitdepth) == (0, 0)


def test_the_format_is_the_upper_case_suffix_of_the_file():
    assert library_file("a", "A", 1, 1, "/music/Album/01 - Song.flac", {}).format == "FLAC"
    assert library_file("a", "A", 1, 1, "/music/Album/song.M4A", {}).format == "M4A"


def test_a_file_without_a_suffix_is_unknown_not_empty():
    assert library_file("a", "A", 1, 1, "/music/README", {}).format == "UNKNOWN"


def test_missing_duration_and_bitrate_are_zero():
    lib = library_file("a", "A", None, None, "/music/x.mp3", {})  # type: ignore[arg-type]

    assert (lib.duration, lib.bitrate) == (0, 0)
