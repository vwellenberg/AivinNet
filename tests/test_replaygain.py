"""ReplayGain tags for the player (#643): which tags count, and which rows to read.

The client evens out loudness from the gain tags in `Track.extra`. Rows indexed
before tinytag 2 lack them even where the files carry them; the backfill reads
each such file once and marks the row.
"""

from types import SimpleNamespace

from aivinnet.lib.replaygain import (
    CHECKED_KEY,
    needs_reading,
    pending,
    replaygain_tags,
    with_replaygain,
)

# What tinytag 2's as_dict() gives for a FLAC tagged by foobar2000 or rsgain.
TAGGED_FLAC = {
    "title": ["Song"],
    "replaygain_track_gain": ["-6.54 dB"],
    "replaygain_track_peak": ["0.988"],
    "replaygain_album_gain": ["-7.10 dB"],
    "replaygain_album_peak": ["0.999"],
    "encoder": ["Lavf60.16.100"],
}


def test_only_the_gain_tags_are_taken():
    assert replaygain_tags(TAGGED_FLAC) == {
        "replaygain_track_gain": ["-6.54 dB"],
        "replaygain_track_peak": ["0.988"],
        "replaygain_album_gain": ["-7.10 dB"],
        "replaygain_album_peak": ["0.999"],
    }


def test_opus_r128_gains_count_too():
    assert replaygain_tags({"r128_track_gain": ["-1792"]}) == {"r128_track_gain": ["-1792"]}


def test_keys_in_any_case_and_bare_values_are_normalised():
    assert replaygain_tags({"REPLAYGAIN_TRACK_GAIN": "-3 dB"}) == {"replaygain_track_gain": ["-3 dB"]}


def test_empty_values_are_dropped():
    assert replaygain_tags({"replaygain_track_gain": [""], "replaygain_track_peak": [None]}) == {}


def test_a_row_without_gain_or_mark_needs_reading():
    assert needs_reading({"track_total": ["12"]})
    assert needs_reading({})
    assert needs_reading(None)


def test_a_row_with_a_gain_or_the_mark_is_done():
    assert not needs_reading({"replaygain_track_gain": ["-6 dB"]})
    assert not needs_reading({CHECKED_KEY: ["1"]})


def test_the_merge_keeps_the_rest_of_extra_and_marks_the_row():
    merged = with_replaygain({"track_total": ["12"]}, {"replaygain_track_gain": ["-6 dB"]})
    assert merged == {"track_total": ["12"], "replaygain_track_gain": ["-6 dB"], CHECKED_KEY: ["1"]}


def test_a_file_without_gain_is_marked_all_the_same():
    """Otherwise every start would read it again."""
    assert with_replaygain({}, {}) == {CHECKED_KEY: ["1"]}


def test_pending_reads_each_file_once_and_skips_done_rows():
    def track(rowid, path, extra):
        return SimpleNamespace(id=rowid, filepath=path, extra=extra)

    tracks = [
        track(1, "/m/a.flac", {}),
        track(1, "/m/a.flac", {}),  # the same row, seen twice in the store
        track(2, "/m/b.flac", {CHECKED_KEY: ["1"]}),
        track(3, "/m/c.flac", {"replaygain_track_gain": ["-2 dB"]}),
        track(4, "/m/d.flac", None),
    ]
    assert [t.id for t in pending(tracks)] == [1, 4]
