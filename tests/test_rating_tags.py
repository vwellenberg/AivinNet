"""Ratings in the audio files (#789): the pure mapping, and real-bytes round trips.

The round trips write into REAL files with REAL mutagen and read them back, the
same way tests/test_tag_writer_roundtrip.py does. The fixtures carry no audio:
a silent MPEG frame, a header-only FLAC, a PCM WAVE with zeros, and an M4A with
an empty moov. Enough for tag I/O.
"""

import struct

import pytest

from aivinnet.lib import rating_tags
from aivinnet.lib.rating_tags import (
    CLEARED,
    UNSUPPORTED,
    WMP_EMAIL,
    WRITTEN,
    RatingTagError,
    clamp_stars,
    percent_value,
    popm_value,
    rating_from_popm,
    read_rating,
    stars_from_percent,
    stars_from_popm,
    write_rating,
)

# --- pure mapping -----------------------------------------------------------


@pytest.mark.parametrize(
    ("stars", "byte"),
    [(1, 1), (2, 64), (3, 128), (4, 196), (5, 255)],
)
def test_popm_value_is_the_standard_byte(stars, byte):
    assert popm_value(stars) == byte


@pytest.mark.parametrize(
    ("byte", "stars"),
    [
        (0, None),  # no rating
        (1, 1),
        (31, 1),  # 1-31 is one star
        (32, 2),
        (63, 2),
        (64, 2),
        (95, 2),
        (96, 3),
        (128, 3),
        (159, 3),
        (160, 4),
        (196, 4),
        (223, 4),
        (224, 5),
        (254, 5),
        (255, 5),
        (256, None),  # not a POPM byte
    ],
)
def test_popm_bytes_map_back_by_the_standard_ranges(byte, stars):
    assert stars_from_popm(byte) == stars


@pytest.mark.parametrize("stars", [1, 2, 3, 4, 5])
def test_popm_round_trips_each_star(stars):
    assert stars_from_popm(popm_value(stars)) == stars


@pytest.mark.parametrize(
    ("value", "stars"),
    [
        (0, None),
        (1, 1),  # below 10 still counts as a rating
        (10, 1),
        (20, 1),
        (30, 2),
        (40, 2),
        (60, 3),
        (80, 4),
        (90, 5),
        (100, 5),
        (120, 5),  # clamped, never above five stars
    ],
)
def test_percent_values_round_to_the_nearest_star(value, stars):
    assert stars_from_percent(value) == stars


@pytest.mark.parametrize("stars", [1, 2, 3, 4, 5])
def test_percent_round_trips_each_star(stars):
    assert stars_from_percent(percent_value(stars)) == stars


def test_percent_values_are_20_40_60_80_100():
    assert [percent_value(s) for s in range(1, 6)] == [20, 40, 60, 80, 100]


def test_wmp_frame_wins_over_other_emails():
    frames = [("someone@else", 255), (WMP_EMAIL, popm_value(2))]
    assert rating_from_popm(frames) == 2


def test_without_wmp_the_first_popm_counts():
    assert rating_from_popm([("a@x", popm_value(4)), ("b@x", popm_value(1))]) == 4


def test_no_popm_is_no_rating():
    assert rating_from_popm([]) is None


def test_zero_wmp_frame_is_no_rating_even_with_others():
    # The WMP frame is the one a player wrote; a zero there means "unrated" for it.
    assert rating_from_popm([(WMP_EMAIL, 0), ("a@x", 255)]) is None


@pytest.mark.parametrize("bad", [0, 6, -1])
def test_out_of_range_stars_are_refused(bad):
    with pytest.raises(RatingTagError):
        clamp_stars(bad)


def test_unsupported_format_is_untouched(tmp_path):
    path = tmp_path / "sample.aac"
    path.write_bytes(b"not really audio")

    assert write_rating(str(path), 4) == UNSUPPORTED
    assert write_rating(str(path), None) == UNSUPPORTED
    assert path.read_bytes() == b"not really audio"
    assert read_rating(str(path)) is None


def test_out_of_range_write_is_refused_before_the_file_is_opened(tmp_path):
    path = tmp_path / "sample.mp3"
    path.write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 413)

    with pytest.raises(RatingTagError):
        write_rating(str(path), 9)
    assert path.read_bytes() == b"\xff\xfb\x90\x00" + b"\x00" * 413


# --- real-bytes fixtures ----------------------------------------------------


def _make_mp3(path) -> None:
    # One MPEG-1 Layer III frame, 128 kbps @ 44.1 kHz, repeated for mutagen's sync scan.
    path.write_bytes((b"\xff\xfb\x90\x00" + b"\x00" * 413) * 4)


def _make_flac(path) -> None:
    # "fLaC" + one STREAMINFO block (44.1 kHz, mono, 16 bit, no samples), marked last.
    streaminfo = struct.pack(">HH", 4096, 4096) + (0).to_bytes(3, "big") + (0).to_bytes(3, "big")
    streaminfo += ((44100 << 44) | (0 << 41) | (15 << 36) | 0).to_bytes(8, "big") + b"\x00" * 16
    path.write_bytes(b"fLaC" + bytes([0x80]) + len(streaminfo).to_bytes(3, "big") + streaminfo)


def _make_wav(path) -> None:
    # RIFF/WAVE with a PCM fmt chunk (mono, 44.1 kHz, 16 bit) and a silent data chunk.
    fmt = struct.pack("<HHIIHH", 1, 1, 44100, 88200, 2, 16)
    data = b"\x00" * 400
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


def _box(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", 8 + len(body)) + kind + body


def _make_m4a(path) -> None:
    # ftyp + moov(mvhd) + free: enough for mutagen to add an ilst.
    ftyp = _box(b"ftyp", b"M4A " + b"\0\0\2\0" + b"M4A isommp42")
    mvhd = _box(b"mvhd", b"\0" * 12 + struct.pack(">II", 1000, 0) + b"\0" * 80)
    path.write_bytes(ftyp + _box(b"moov", mvhd) + _box(b"free", b"\0" * 8))


MAKERS = {"mp3": _make_mp3, "flac": _make_flac, "wav": _make_wav, "m4a": _make_m4a}


@pytest.fixture(params=sorted(MAKERS))
def audio_file(request, tmp_path):
    path = tmp_path / f"sample.{request.param}"
    MAKERS[request.param](path)
    return str(path)


# --- real-bytes round trips -------------------------------------------------


@pytest.mark.parametrize("stars", [1, 2, 3, 4, 5])
def test_round_trip_write_then_read(audio_file, stars):
    assert write_rating(audio_file, stars) == WRITTEN
    assert read_rating(audio_file) == stars


def test_clear_removes_the_rating(audio_file):
    write_rating(audio_file, 5)
    assert write_rating(audio_file, None) == CLEARED
    assert read_rating(audio_file) is None


def test_clear_on_an_unrated_file_is_harmless(audio_file):
    assert write_rating(audio_file, None) == CLEARED
    assert read_rating(audio_file) is None


def test_rewrite_replaces_the_earlier_rating(audio_file):
    write_rating(audio_file, 2)
    write_rating(audio_file, 4)
    assert read_rating(audio_file) == 4


def test_the_raw_field_holds_the_convention(audio_file):
    import mutagen
    from mutagen.id3 import ID3

    write_rating(audio_file, 3)
    kind = audio_file.rsplit(".", 1)[1]

    if kind in ("mp3", "wav"):
        from mutagen.mp3 import MP3
        from mutagen.wave import WAVE

        audio = WAVE(audio_file) if kind == "wav" else MP3(audio_file)
        assert isinstance(audio.tags, ID3)
        assert audio.tags.getall("POPM")[0].rating == 128
        assert audio.tags.getall("POPM")[0].email == WMP_EMAIL
    elif kind == "flac":
        assert mutagen.File(audio_file).tags["RATING"] == ["60"]
    else:
        assert mutagen.File(audio_file).tags["rate"] == ["60"]


def test_id3_clear_keeps_another_players_popm(tmp_path):
    from mutagen.id3 import POPM
    from mutagen.mp3 import MP3

    path = tmp_path / "other.mp3"
    _make_mp3(path)
    audio = MP3(str(path))
    audio.add_tags()
    audio.tags.add(POPM(email="someone@else", rating=200, count=0))
    audio.save()

    write_rating(str(path), 5)
    write_rating(str(path), None)

    emails = [frame.email for frame in MP3(str(path)).tags.getall("POPM")]
    assert emails == ["someone@else"]
    assert read_rating(str(path)) == 4  # the other player's 200 is still there: 4 stars


def test_wav_round_trip_survives_the_info_block(tmp_path):
    # A WAV with a RIFF LIST/INFO block (from ffmpeg) keeps it when the ID3 chunk is added.
    from mutagen.wave import WAVE

    path = tmp_path / "info.wav"
    _make_wav(path)
    raw = path.read_bytes()
    info = b"LIST" + struct.pack("<I", 12) + b"INFOINAM" + struct.pack("<I", 0)
    path.write_bytes(raw[:4] + struct.pack("<I", len(raw) - 8 + len(info)) + raw[8:] + info)

    assert write_rating(str(path), 3) == WRITTEN
    assert read_rating(str(path)) == 3
    assert WAVE(str(path)).tags is not None


def test_unreadable_supported_file_raises(tmp_path):
    path = tmp_path / "broken.flac"
    path.write_bytes(b"this is not flac")

    with pytest.raises(RatingTagError):
        read_rating(str(path))


def test_module_exposes_the_formats_it_writes():
    assert rating_tags.is_supported("a.MP3")
    assert rating_tags.is_supported("a.opus")
    assert rating_tags.is_supported("a.m4a")
    assert not rating_tags.is_supported("a.wma")


# --- review of #789 ---------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "stars"),
    [
        ("80", 4),  # 0..100, MediaMonkey and this app
        ("100", 5),
        ("5", 5),  # 1..5, foobar2000: read as 0..100 it was 1 star
        ("3", 3),
        ("0.8", 4),  # 0.0..1.0, Kodi: int() made the file "unreadable"
        ("4.0", 4),
        (b"60", 3),  # an MP4 atom handed over as bytes
        ("0", None),
    ],
)
def test_other_players_rating_scales_are_read(raw, stars):
    assert rating_tags.stars_from_text(raw) == stars


def test_a_rating_that_is_no_number_is_unreadable():
    with pytest.raises(RatingTagError):
        rating_tags.stars_from_text("five")


def test_an_id3v23_tag_stays_v23(tmp_path):
    """mutagen saves v2.4 by default; older Windows and car players read v2.3 only."""
    from mutagen.id3 import ID3, TIT2

    path = tmp_path / "old.mp3"
    _make_mp3(path)
    tags = ID3()
    tags.add(TIT2(encoding=1, text="Song"))
    tags.save(str(path), v2_version=3)

    rating_tags.write_rating(str(path), 4)

    assert ID3(str(path)).version[:2] == (2, 3)
    assert rating_tags.read_rating(str(path)) == 4
