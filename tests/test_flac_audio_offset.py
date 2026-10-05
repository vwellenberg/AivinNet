"""FLAC files with an ID3v2 tag in front of the `fLaC` marker.

Firefox refuses such files ("could not be decoded",
NS_ERROR_DOM_MEDIA_METADATA_ERR) while Chrome/Edge/Safari play them — a
tester's whole library would not play in Firefox. The stream endpoint sends
them from the `fLaC` marker on; this finds where that is.
"""

from aivinnet.utils.files import flac_audio_offset

FLAC = b"fLaC" + b"\x00" * 60  # stands in for STREAMINFO and the frames


def id3(payload: bytes, *, footer: bool = False) -> bytes:
    size = len(payload)
    syncsafe = bytes(((size >> s) & 0x7F) for s in (21, 14, 7, 0))
    flags = 0x10 if footer else 0
    out = b"ID3\x03\x00" + bytes([flags]) + syncsafe + payload
    if footer:
        out += b"3DI\x03\x00" + bytes([flags]) + syncsafe
    return out


def write(tmp_path, data: bytes):
    path = tmp_path / "a.flac"
    path.write_bytes(data)
    return str(path)


def test_a_clean_flac_starts_at_zero(tmp_path):
    assert flac_audio_offset(write(tmp_path, FLAC)) == 0


def test_an_id3_tag_in_front_is_skipped(tmp_path):
    tag = id3(b"TIT2" + b"\x00" * 300)
    assert flac_audio_offset(write(tmp_path, tag + FLAC)) == len(tag)


def test_a_large_tag_uses_the_syncsafe_size(tmp_path):
    # > 127 bytes per size byte: a plain big-endian read gets this wrong.
    tag = id3(b"\x00" * 600_000)
    assert flac_audio_offset(write(tmp_path, tag + FLAC)) == len(tag)


def test_a_tag_with_footer(tmp_path):
    tag = id3(b"\x00" * 50, footer=True)
    assert flac_audio_offset(write(tmp_path, tag + FLAC)) == len(tag)


def test_stacked_tags(tmp_path):
    tags = id3(b"\x00" * 20) + id3(b"\x01" * 40)
    assert flac_audio_offset(write(tmp_path, tags + FLAC)) == len(tags)


def test_no_flac_marker_after_the_tag_is_left_alone(tmp_path):
    # An MP3 misnamed .flac, or a tag size that lies: send the file unchanged.
    assert flac_audio_offset(write(tmp_path, id3(b"\x00" * 20) + b"\xff\xfb" + b"\x00" * 50)) == 0


def test_a_broken_size_is_left_alone(tmp_path):
    assert flac_audio_offset(write(tmp_path, b"ID3\x03\x00\x00\x80\x80\x80\x80" + FLAC)) == 0


def test_a_truncated_or_missing_file(tmp_path):
    assert flac_audio_offset(write(tmp_path, b"ID3")) == 0
    assert flac_audio_offset(str(tmp_path / "missing.flac")) == 0
