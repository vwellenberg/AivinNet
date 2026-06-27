"""Real-bytes round-trip tests for tag_writer.write_tags.

Unlike test_tag_writer.py (which only exercises the pure helpers with mutagen
mocked), these write tags into REAL audio files with REAL mutagen and read them
back — once with mutagen and once with tinytag, the library the app actually
reads with (swingmusic.lib.taglib.get_tags). That second read guards the
mutagen-writes / tinytag-reads asymmetry the comma-join in write_tags relies on,
and exercises the only code path that mutates a user's files irreversibly.

The fixtures are minimal but valid: a single silent MPEG-1 Layer III frame and a
header-only FLAC stream. They carry no audio payload — enough for tag I/O,
nothing more — so no binary blobs need to be committed.
"""

import struct

import pytest

from swingmusic.lib.tag_writer import TagWriteError, write_tags

NEW_TAGS = {
    "title": "New Title",
    "album": "New Album",
    "artists": ["Alpha", "Beta"],
    "albumartists": ["Gamma"],
    "track": 7,
}


def _make_mp3(path) -> None:
    # One MPEG-1 Layer III frame, 128 kbps @ 44.1 kHz: header 0xFF 0xFB 0x90 0x00
    # + a zero-filled body to the 417-byte frame length. A few identical frames
    # so mutagen's sync scan is unambiguous.
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413
    path.write_bytes(frame * 4)


def _make_flac(path) -> None:
    # "fLaC" + a single STREAMINFO metadata block (type 0), marked as the last
    # block. Body describes 44.1 kHz / mono / 16-bit / 0 samples.
    sample_rate, channels, bps, total_samples = 44100, 1, 16, 0
    streaminfo = struct.pack(">HH", 4096, 4096)  # min/max block size
    streaminfo += (0).to_bytes(3, "big") + (0).to_bytes(3, "big")  # min/max frame size
    packed = (sample_rate << 44) | ((channels - 1) << 41) | ((bps - 1) << 36) | total_samples
    streaminfo += packed.to_bytes(8, "big")
    streaminfo += b"\x00" * 16  # MD5 signature
    assert len(streaminfo) == 34
    header = bytes([0x80]) + len(streaminfo).to_bytes(3, "big")  # last block, type 0
    path.write_bytes(b"fLaC" + header + streaminfo)


@pytest.fixture(params=["mp3", "flac"])
def audio_file(request, tmp_path):
    path = tmp_path / f"sample.{request.param}"
    (_make_mp3 if request.param == "mp3" else _make_flac)(path)
    return str(path)


def test_roundtrip_via_mutagen(audio_file):
    write_tags(audio_file, NEW_TAGS)

    import mutagen

    audio = mutagen.File(audio_file, easy=True)
    assert audio["title"] == ["New Title"]
    assert audio["album"] == ["New Album"]
    assert audio["artist"] == ["Alpha, Beta"]  # multiple artists are comma-joined
    assert audio["albumartist"] == ["Gamma"]
    assert audio["tracknumber"] == ["7"]


def test_roundtrip_via_tinytag(audio_file):
    # tinytag is the app's read path; this is the assertion that actually matters
    # for trackhash stability after an edit.
    write_tags(audio_file, NEW_TAGS)

    from tinytag import TinyTag

    tag = TinyTag.get(audio_file)
    assert tag.title == "New Title"
    assert tag.album == "New Album"
    assert tag.artist == "Alpha, Beta"
    assert tag.albumartist == "Gamma"
    assert str(tag.track) == "7"


def test_rejects_non_audio_file(tmp_path):
    path = tmp_path / "not_audio.txt"
    path.write_text("definitely not audio")
    with pytest.raises(TagWriteError):
        write_tags(str(path), {"title": "x", "album": "y", "artists": ["z"]})


def test_empty_required_field_rejected_before_touching_file(tmp_path):
    # Validation must fail before the file is opened/written.
    path = tmp_path / "sample.mp3"
    _make_mp3(path)
    before = path.read_bytes()
    with pytest.raises(TagWriteError):
        write_tags(str(path), {"title": "  ", "album": "A", "artists": ["x"]})
    assert path.read_bytes() == before  # untouched
