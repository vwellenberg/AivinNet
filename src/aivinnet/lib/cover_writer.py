"""
Embed cover art into an audio file using mutagen (issue #97 P1b).

The sibling of ``tag_writer`` for the one thing it deliberately left out: where
text tags map onto a uniform "easy" key across containers, a picture does not.
Every container stores it differently — ID3 ``APIC`` frames, MP4 ``covr`` atoms,
native FLAC picture blocks, a base64-wrapped FLAC picture block inside a Vorbis
comment for Ogg — so this module dispatches per container and refuses loudly for
the ones it cannot serve.

Refusing loudly is the point: a silent skip would leave the user believing their
files were cleaned up when half the album still carries no art. Every failure
raises, and the caller reports it per file.

The picture REPLACES whatever art the file carried (front-cover pictures are
cleared first). A file with three stale covers should end up with one correct
one, not four.
"""

from __future__ import annotations

import os

# mutagen is imported lazily inside the writers so this module's pure helpers
# (and their tests) don't require the dependency — same pattern as tag_writer.

# INFO: Containers we can embed a picture into. This is only a cheap pre-filter
# so an unsupported file is rejected BEFORE its (possibly hundreds of MB)
# backup copy is made; mutagen stays the authority inside write_cover.
SUPPORTED_EXTENSIONS = {
    ".mp3",
    ".flac",
    ".m4a",
    ".m4b",
    ".mp4",
    ".ogg",
    ".oga",
    ".opus",
    ".wav",
    ".wave",
    ".aif",
    ".aiff",
    ".aifc",
}

# The picture type used for a cover, per the ID3v2/FLAC picture-type table.
FRONT_COVER = 3


class CoverWriteError(Exception):
    """Raised when cover art cannot be written to a file."""


class UnsupportedCoverFormatError(CoverWriteError):
    """Raised when the file's container has no cover-art slot we can write."""


def file_extension(filepath: str) -> str:
    """The lowercased extension of ``filepath``, including the dot."""
    return os.path.splitext(filepath)[1].lower()


def supports(filepath: str) -> bool:
    """Whether ``write_cover`` has a chance at this file (extension pre-filter)."""
    return file_extension(filepath) in SUPPORTED_EXTENSIONS


def _flac_picture(image_bytes: bytes, mime: str, width: int, height: int):
    """A mutagen FLAC Picture block — also the payload Ogg files carry."""
    from mutagen.flac import Picture

    picture = Picture()
    picture.type = FRONT_COVER
    picture.mime = mime
    picture.desc = "Cover"
    picture.width = width
    picture.height = height
    # 24-bit colour. Callers hand us RGB JPEG/PNG; the field is informational
    # and a wrong value here breaks nothing, but 0 makes some taggers complain.
    picture.depth = 24
    picture.data = image_bytes
    return picture


def _write_flac(audio, image_bytes: bytes, mime: str, width: int, height: int) -> None:
    audio.clear_pictures()
    audio.add_picture(_flac_picture(image_bytes, mime, width, height))


def _write_mp4(audio, image_bytes: bytes, mime: str) -> None:
    from mutagen.mp4 import MP4Cover

    formats = {"image/jpeg": MP4Cover.FORMAT_JPEG, "image/png": MP4Cover.FORMAT_PNG}
    if mime not in formats:
        # The MP4 covr atom only knows these two; there is no generic mime field.
        raise UnsupportedCoverFormatError(f"MP4 covers must be JPEG or PNG, not {mime}")

    audio["covr"] = [MP4Cover(image_bytes, imageformat=formats[mime])]


def _write_ogg(audio, image_bytes: bytes, mime: str, width: int, height: int) -> None:
    import base64

    picture = _flac_picture(image_bytes, mime, width, height)
    audio["metadata_block_picture"] = [base64.b64encode(picture.write()).decode("ascii")]

    # Old players wrote the cover into these non-standard fields. Leaving them
    # behind would keep a stale image in whatever reads them first.
    for legacy in ("coverart", "coverartmime"):
        if legacy in audio:
            del audio[legacy]


def _write_id3(tags, image_bytes: bytes, mime: str) -> None:
    from mutagen.id3 import APIC

    tags.delall("APIC")
    tags.add(APIC(encoding=3, mime=mime, type=FRONT_COVER, desc="Cover", data=image_bytes))


def write_cover(filepath: str, image_bytes: bytes, mime: str = "image/jpeg", width: int = 0, height: int = 0) -> None:
    """
    Embed ``image_bytes`` as the front cover of the audio file at ``filepath``.

    Existing front-cover art is replaced, not appended.

    :param filepath: Path to the audio file.
    :param image_bytes: The encoded image (JPEG or PNG).
    :param mime: The image's mime type.
    :param width: Pixel width, stored in the FLAC/Ogg picture block (optional).
    :param height: Pixel height, likewise.
    :raises UnsupportedCoverFormatError: If the container has no writable cover slot.
    :raises CoverWriteError: If the file cannot be read or saved.
    """
    import mutagen
    from mutagen.flac import FLAC
    from mutagen.id3 import ID3
    from mutagen.mp4 import MP4
    from mutagen.oggflac import OggFLAC
    from mutagen.oggopus import OggOpus
    from mutagen.oggvorbis import OggVorbis

    if not image_bytes:
        raise CoverWriteError("Empty cover image")

    if not supports(filepath):
        raise UnsupportedCoverFormatError(f"Unsupported format: {file_extension(filepath) or 'no extension'}")

    try:
        audio = mutagen.File(filepath)
    except Exception as exc:  # mutagen raises various per-format errors
        raise CoverWriteError(f"Could not read audio file: {exc}") from exc

    if audio is None:
        raise UnsupportedCoverFormatError(f"Unsupported audio file: {os.path.basename(filepath)}")

    if audio.tags is None:
        try:
            audio.add_tags()
        except Exception as exc:
            raise CoverWriteError(f"Could not initialise tags: {exc}") from exc

    # Order matters: FLAC and the Ogg types carry Vorbis comments, so they have
    # to be recognised before the generic "has ID3 tags" branch (which covers
    # MP3 and the ID3-in-a-RIFF/AIFF chunk containers) gets a look in.
    if isinstance(audio, FLAC):
        _write_flac(audio, image_bytes, mime, width, height)
    elif isinstance(audio, MP4):
        _write_mp4(audio, image_bytes, mime)
    elif isinstance(audio, (OggVorbis, OggOpus, OggFLAC)):
        _write_ogg(audio, image_bytes, mime, width, height)
    elif isinstance(audio.tags, ID3):
        _write_id3(audio.tags, image_bytes, mime)
    else:
        raise UnsupportedCoverFormatError(f"No cover art support for {type(audio).__name__} files")

    try:
        audio.save()
    except Exception as exc:
        raise CoverWriteError(f"Could not save cover: {exc}") from exc
