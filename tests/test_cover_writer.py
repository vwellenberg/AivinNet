"""Real-bytes tests for cover_writer.write_cover.

The same reasoning as test_tag_writer_roundtrip: this is code that mutates a
user's files irreversibly, so it is exercised against REAL audio bytes with REAL
mutagen rather than against a mock that would happily agree with any API misuse.

Fixtures are synthesised (a silent MPEG frame, a header-only FLAC stream, a tiny
RIFF/WAVE) so no binary blobs need committing. MP4 and Ogg cannot be synthesised
this cheaply — their per-container writers are therefore tested directly, with
real mutagen picture/cover objects and a dict standing in for the tag store, and
verified against actual library files on the server.
"""

import struct

import pytest

from swingmusic.lib.cover_writer import (
    CoverWriteError,
    UnsupportedCoverFormatError,
    _write_mp4,
    _write_ogg,
    supports,
    write_cover,
)

# Stand-in cover bytes. Nothing here decodes the image — mutagen stores the
# payload verbatim — so a JPEG magic number plus filler is a truthful fixture
# and keeps the file free of a committed binary blob. (The real pipeline feeds
# a Pillow-encoded JPEG; that end is covered in tests_api.)
JPEG = b"\xff\xd8\xff\xe0" + b"pretend-this-is-a-cover" * 8 + b"\xff\xd9"


def _make_mp3(path) -> None:
    # One MPEG-1 Layer III frame, 128 kbps @ 44.1 kHz, repeated so mutagen's
    # sync scan is unambiguous (same fixture shape as test_tag_writer_roundtrip).
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413
    path.write_bytes(frame * 4)


def _make_flac(path) -> None:
    # "fLaC" + a single STREAMINFO block (type 0), marked as the last block.
    sample_rate, channels, bps, total_samples = 44100, 1, 16, 0
    streaminfo = struct.pack(">HH", 4096, 4096)
    streaminfo += (0).to_bytes(3, "big") + (0).to_bytes(3, "big")
    packed = (sample_rate << 44) | ((channels - 1) << 41) | ((bps - 1) << 36) | total_samples
    streaminfo += packed.to_bytes(8, "big")
    streaminfo += b"\x00" * 16
    header = bytes([0x80]) + len(streaminfo).to_bytes(3, "big")
    path.write_bytes(b"fLaC" + header + streaminfo)


def _make_wav(path) -> None:
    import wave

    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(44100)
        f.writeframes(b"\x00\x00" * 16)


MAKERS = {"mp3": _make_mp3, "flac": _make_flac, "wav": _make_wav}


@pytest.fixture(params=sorted(MAKERS))
def audio_file(request, tmp_path):
    path = tmp_path / f"sample.{request.param}"
    MAKERS[request.param](path)
    return str(path)


def read_cover(filepath: str) -> bytes:
    """The embedded front cover of a file, read back the way a player would."""
    import mutagen
    from mutagen.flac import FLAC

    audio = mutagen.File(filepath)

    if isinstance(audio, FLAC):
        return audio.pictures[0].data

    # The remaining fixtures (mp3, wav) all store the cover in an ID3 APIC frame.
    return audio.tags.getall("APIC")[0].data


class TestWriteCover:
    def test_embeds_the_picture(self, audio_file):
        write_cover(audio_file, JPEG, "image/jpeg", 1, 1)
        assert read_cover(audio_file) == JPEG

    def test_second_write_replaces_instead_of_appending(self, audio_file):
        # A file that already carries a wrong cover must end up with exactly
        # one picture, not with the old one still in front of the new one.
        write_cover(audio_file, JPEG, "image/jpeg", 1, 1)
        other = JPEG[:-2] + b"\x00" + JPEG[-1:]
        write_cover(audio_file, other, "image/jpeg", 1, 1)

        import mutagen
        from mutagen.flac import FLAC

        audio = mutagen.File(audio_file)
        if isinstance(audio, FLAC):
            assert len(audio.pictures) == 1
        else:
            assert len(audio.tags.getall("APIC")) == 1

        assert read_cover(audio_file) == other

    def test_text_tags_and_therefore_the_trackhash_survive(self, audio_file):
        # The claim in album_cover_edit's module docstring, asserted: the
        # trackhash is create_hash(artists, album, title), so embedding a
        # picture must leave those three tags byte-identical. If this ever goes
        # red, every playlist/favourite/scrobble reference to the album breaks.
        from swingmusic.lib.tag_writer import write_tags
        from swingmusic.utils.hashing import create_hash

        write_tags(audio_file, {"title": "Song", "album": "Record", "artists": ["A", "B"]})

        from tinytag import TinyTag

        def identity() -> str:
            tag = TinyTag.get(audio_file)
            return create_hash(tag.artist or "", tag.album or "", tag.title or "")

        before = identity()
        write_cover(audio_file, JPEG, "image/jpeg", 1, 1)

        assert identity() == before

    def test_empty_image_is_rejected_before_the_file_is_touched(self, audio_file):
        with open(audio_file, "rb") as f:
            before = f.read()

        with pytest.raises(CoverWriteError):
            write_cover(audio_file, b"", "image/jpeg")

        with open(audio_file, "rb") as f:
            assert f.read() == before

    def test_unsupported_container_raises_instead_of_skipping(self, tmp_path):
        # Loud failure is the whole point: a silent skip would leave the user
        # believing the album was written when half of it was not.
        path = tmp_path / "sample.wma"
        path.write_bytes(b"not really a wma")

        with pytest.raises(UnsupportedCoverFormatError) as excinfo:
            write_cover(str(path), JPEG)

        assert ".wma" in str(excinfo.value)

    def test_non_audio_with_a_supported_extension_raises(self, tmp_path):
        path = tmp_path / "sample.mp3"
        path.write_text("definitely not audio")

        with pytest.raises(CoverWriteError):
            write_cover(str(path), JPEG)


class TestSupports:
    def test_known_containers(self):
        assert supports("/music/a.MP3")
        assert supports("/music/a.flac")
        assert supports("/music/a.opus")

    def test_unknown_containers(self):
        assert not supports("/music/a.wma")
        assert not supports("/music/a.ape")
        assert not supports("/music/no_extension")


class TestMp4Writer:
    def test_writes_a_covr_atom(self):
        from mutagen.mp4 import MP4Cover

        audio = {}
        _write_mp4(audio, JPEG, "image/jpeg")

        assert audio["covr"] == [MP4Cover(JPEG, imageformat=MP4Cover.FORMAT_JPEG)]
        assert audio["covr"][0].imageformat == MP4Cover.FORMAT_JPEG

    def test_png_uses_the_png_format_flag(self):
        from mutagen.mp4 import MP4Cover

        audio = {}
        _write_mp4(audio, JPEG, "image/png")

        assert audio["covr"][0].imageformat == MP4Cover.FORMAT_PNG

    def test_other_mime_types_are_refused(self):
        # The covr atom has no mime field — only a JPEG/PNG flag — so a webp
        # would be stored as a lie about its own format.
        with pytest.raises(UnsupportedCoverFormatError):
            _write_mp4({}, JPEG, "image/webp")


class TestOggWriter:
    def test_writes_a_base64_flac_picture_block(self):
        import base64

        from mutagen.flac import Picture

        audio = {}
        _write_ogg(audio, JPEG, "image/jpeg", 40, 30)

        picture = Picture(base64.b64decode(audio["metadata_block_picture"][0]))
        assert picture.data == JPEG
        assert picture.mime == "image/jpeg"
        assert picture.type == 3  # front cover
        assert (picture.width, picture.height) == (40, 30)

    def test_legacy_cover_fields_are_dropped(self):
        # Old taggers put the image in these non-standard keys; leaving them
        # behind means whatever reads them first still shows the old cover.
        audio = {"coverart": ["base64..."], "coverartmime": ["image/png"]}
        _write_ogg(audio, JPEG, "image/jpeg", 1, 1)

        assert "coverart" not in audio
        assert "coverartmime" not in audio
