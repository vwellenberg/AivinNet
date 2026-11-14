"""Enhanced LRC: word stamps come back as timed words, not as part of the lyric.

An "A2" / enhanced LRC file stamps every word of a line, in angle brackets:

    [01:15.00]<01:15.00>Light <01:15.42>up <01:15.80>the <01:16.31>night

The parser only knew the square-bracket line stamp, so everything after it
was the lyric — the view showed `<01:15.00>Light <01:15.42>up …` verbatim.
Now the line text is the plain words, and the stamps come back as a `words`
list the view highlights word by word. Lines without word stamps keep the
old shape exactly (no `words` key), so an older client sees no change.
"""

from types import SimpleNamespace

import pytest

from aivinnet.lib.lyrics import Lyrics

ENHANCED = (
    "[ti:Light up the night]\n"
    "[01:12.00]Lets set the world on fire\n"
    "[01:15.00]<01:15.00>Light <01:15.42>up <01:15.80>the <01:16.31>night<01:17.90>\n"
)


def test_a_line_without_word_stamps_keeps_its_old_shape():
    lines = Lyrics(ENHANCED).format_synced_lyrics()

    assert lines[0] == {"time": 72000.0, "text": "Lets set the world on fire"}


def test_word_stamps_are_taken_out_of_the_text():
    line = Lyrics(ENHANCED).format_synced_lyrics()[1]

    assert line["time"] == 75000.0
    assert line["text"] == "Light up the night"


def test_each_word_carries_the_time_it_starts():
    words = Lyrics(ENHANCED).format_synced_lyrics()[1]["words"]

    # The closing stamp (<01:17.90>) has no word after it and only ends the line.
    assert words == [
        {"time": 75000.0, "text": "Light "},
        {"time": 75420.0, "text": "up "},
        {"time": 75800.0, "text": "the "},
        {"time": 76310.0, "text": "night"},
    ]


def test_the_words_join_back_to_the_text_spaces_included():
    """The view lays the words out one after another, so nothing may go missing."""
    line = Lyrics("[00:01.00]<00:01.00>One, <00:01.50>two  <00:02.00>three").format_synced_lyrics()[0]

    assert "".join(w["text"] for w in line["words"]) == line["text"] == "One, two  three"


def test_text_before_the_first_stamp_belongs_to_the_first_word():
    line = Lyrics("[00:01.00]Oh <00:01.50>yeah").format_synced_lyrics()[0]

    assert line["text"] == "Oh yeah"
    assert line["words"] == [{"time": 1500.0, "text": "Oh yeah"}]


def test_the_offset_moves_the_words_with_their_line():
    line = Lyrics("[offset:500]\n[00:02.00]<00:02.00>A <00:03.00>B").format_synced_lyrics()[0]

    assert line["time"] == 1500.0
    assert [w["time"] for w in line["words"]] == [1500.0, 2500.0]


def test_fractions_are_hundredths_in_word_stamps_too():
    """Same rule as the line stamp: `.42` is 420 ms, not 42 ms."""
    words = Lyrics("[00:00.00]<00:00.42>a <00:00.5>b <00:00.123>c").format_synced_lyrics()[0]["words"]

    assert [w["time"] for w in words] == [420.0, 500.0, 123.0]


# ------------------------------------------------------------------ endpoint

TRACKHASH = "5f0c8e2d9b1a4c37"


@pytest.fixture()
def song(monkeypatch, tmp_path):
    from aivinnet.store.tracks import TrackStore

    path = tmp_path / "Light up the night.mp3"
    path.write_bytes(b"x")
    path.with_suffix(".lrc").write_text(ENHANCED)
    track = SimpleNamespace(filepath=path.as_posix(), trackhash=TRACKHASH, bitrate=320, copyright="", extra={})
    group = SimpleNamespace(tracks=[track])
    monkeypatch.setattr(TrackStore, "trackhashmap", {TRACKHASH: group}, raising=False)
    return path


def test_get_lyrics_sends_the_timed_words(api_client, song):
    api = api_client("aivinnet.api.lyrics")

    res = api.post("/lyrics", json={"trackhash": TRACKHASH, "filepath": song.as_posix()})

    assert res.status_code == 200
    assert res.json["synced"] is True
    first, second = res.json["lyrics"]
    assert "words" not in first
    assert second["text"] == "Light up the night"
    assert second["words"][1] == {"time": 75420.0, "text": "up "}


def test_a_closing_stamp_with_a_trailing_space_is_not_a_word():
    """An empty last word would take the marker off the real one, as if the line ended."""
    line = Lyrics("[00:01.00]<00:01.00>Light <00:01.50>night<00:02.00> ").format_synced_lyrics()[0]

    assert [w["text"] for w in line["words"]] == ["Light ", "night "]
    assert line["text"] == "Light night "


def test_a_repeated_line_moves_its_words_with_it():
    """A chorus written once under two line stamps is sung word by word both times."""
    first, repeat = Lyrics("[00:10.00][01:30.00]<00:10.00>Hey <00:10.40>you").format_synced_lyrics()

    assert [w["time"] for w in first["words"]] == [10000.0, 10400.0]
    assert [w["time"] for w in repeat["words"]] == [90000.0, 90400.0]
