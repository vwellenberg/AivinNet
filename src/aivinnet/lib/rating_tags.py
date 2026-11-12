"""
Ratings (1 to 5 stars) as tags in the audio files (#789).

Two layers, kept apart so the mapping can be tested without any file:

- the pure functions (``popm_value``, ``rating_from_popm``, …) hold the
  conventions and nothing else;
- ``write_rating`` / ``read_rating`` do the mutagen I/O, per container.

Conventions, the ones other players already read:

- MP3 and WAV: ID3 ``POPM`` with the email ``Windows Media Player 9 Series``,
  1..5 stars -> 1 / 64 / 128 / 196 / 255. Reading takes the WMP frame first and
  otherwise the first POPM of any email.
- FLAC, Ogg Vorbis, Opus: Vorbis comment ``RATING``, 20 / 40 / 60 / 80 / 100.
- M4A / MP4: atom ``rate``, the same 0..100 string.

Other formats are not touched at all (``"unsupported"``).

Clearing removes only what this writes: the WMP ``POPM`` frame, the ``RATING``
key, the ``rate`` atom. A POPM of another email stays in the file.
"""

from __future__ import annotations

from pathlib import Path

WMP_EMAIL = "Windows Media Player 9 Series"

# Stars -> the value each convention stores.
_POPM_FOR_STARS = {1: 1, 2: 64, 3: 128, 4: 196, 5: 255}
_PERCENT_FOR_STARS = {1: 20, 2: 40, 3: 60, 4: 80, 5: 100}

# POPM byte -> stars, by the ranges every reader uses (1-31 is one star, …).
_POPM_RANGES = ((31, 1), (95, 2), (159, 3), (223, 4), (255, 5))

WRITTEN = "written"
CLEARED = "cleared"
UNSUPPORTED = "unsupported"

_ID3_SUFFIXES = {".mp3", ".wav"}
_VORBIS_SUFFIXES = {".flac", ".ogg", ".oga", ".opus"}
_MP4_SUFFIXES = {".m4a", ".mp4", ".m4b"}


class RatingTagError(Exception):
    """A file that should carry a rating could not be read or written."""


# --- pure mapping -----------------------------------------------------------


def popm_value(stars: int) -> int:
    """The POPM byte that stands for `stars` (1..5)."""
    return _POPM_FOR_STARS[stars]


def stars_from_popm(value: int) -> int | None:
    """Stars for a POPM byte; 0 means no rating (None). Values above 255 are not POPM."""
    if value <= 0:
        return None
    for upper, stars in _POPM_RANGES:
        if value <= upper:
            return stars
    return None


def percent_value(stars: int) -> int:
    """The 0..100 value Vorbis RATING and the MP4 `rate` atom store for `stars`."""
    return _PERCENT_FOR_STARS[stars]


def stars_from_percent(value: int) -> int | None:
    """Stars for a 0..100 value, rounded to the nearest of 1..5; 0 means none."""
    if value <= 0:
        return None
    return max(1, min(5, (value + 10) // 20))


def rating_from_popm(frames: list[tuple[str, int]]) -> int | None:
    """
    The rating of a file from its POPM frames, given as (email, byte) pairs.

    The WMP frame wins; without one, the first frame of any email counts.
    """
    if not frames:
        return None
    chosen = next((value for email, value in frames if email == WMP_EMAIL), frames[0][1])
    return stars_from_popm(chosen)


def clamp_stars(stars: int) -> int:
    if not 1 <= stars <= 5:
        raise RatingTagError(f"A rating is 1 to 5, not {stars}")
    return stars


# --- file I/O ---------------------------------------------------------------


def is_supported(filepath: str) -> bool:
    suffix = Path(filepath).suffix.lower()
    return suffix in _ID3_SUFFIXES or suffix in _VORBIS_SUFFIXES or suffix in _MP4_SUFFIXES


def write_rating(filepath: str, stars: int | None) -> str:
    """
    Write one rating (1..5) into the file, or clear it (`stars` None).

    Returns WRITTEN, CLEARED, or UNSUPPORTED (the file is not touched then).
    Raises RatingTagError when a supported file cannot be read or saved.
    """
    if not is_supported(filepath):
        return UNSUPPORTED
    if stars is not None:
        clamp_stars(stars)

    suffix = Path(filepath).suffix.lower()
    try:
        if suffix in _ID3_SUFFIXES:
            _write_id3(filepath, stars)
        elif suffix in _VORBIS_SUFFIXES:
            _write_vorbis(filepath, stars)
        else:
            _write_mp4(filepath, stars)
    except RatingTagError:
        raise
    except Exception as exc:
        raise RatingTagError(f"Could not write the rating: {exc}") from exc

    return CLEARED if stars is None else WRITTEN


def read_rating(filepath: str) -> int | None:
    """
    The rating stored in the file, 1..5, or None when it has none.

    Raises RatingTagError when the file cannot be read. Unsupported formats
    return None: the caller decides before reading whether to ask at all.
    """
    if not is_supported(filepath):
        return None
    suffix = Path(filepath).suffix.lower()
    try:
        if suffix in _ID3_SUFFIXES:
            return _read_id3(filepath)
        if suffix in _VORBIS_SUFFIXES:
            return _read_vorbis(filepath)
        return _read_mp4(filepath)
    except RatingTagError:
        raise
    except Exception as exc:
        raise RatingTagError(f"Could not read the rating: {exc}") from exc


def _id3_container(filepath: str):
    """The ID3-carrying container: WAVE for .wav (its tag is a chunk), MP3 otherwise."""
    if Path(filepath).suffix.lower() == ".wav":
        from mutagen.wave import WAVE

        return WAVE(filepath)
    from mutagen.mp3 import MP3

    return MP3(filepath)


def _write_id3(filepath: str, stars: int | None) -> None:
    from mutagen.id3 import POPM

    audio = _id3_container(filepath)
    key = f"POPM:{WMP_EMAIL}"
    if stars is None:
        if audio.tags is not None and key in audio.tags:
            del audio.tags[key]
            audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    # The frame's hash key is "POPM:<email>", so adding replaces this email's frame only.
    audio.tags.add(POPM(email=WMP_EMAIL, rating=popm_value(stars), count=0))
    audio.save()


def _read_id3(filepath: str) -> int | None:
    audio = _id3_container(filepath)
    if audio.tags is None:
        return None
    frames = [(frame.email, frame.rating) for frame in audio.tags.getall("POPM")]
    return rating_from_popm(frames)


def _write_vorbis(filepath: str, stars: int | None) -> None:
    from mutagen import File

    audio = File(filepath)
    if audio is None:
        raise RatingTagError("Not an audio file mutagen understands")
    if stars is None:
        if audio.tags is not None and "RATING" in audio.tags:
            del audio.tags["RATING"]
            audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    audio.tags["RATING"] = [str(percent_value(stars))]
    audio.save()


def _read_vorbis(filepath: str) -> int | None:
    from mutagen import File

    audio = File(filepath)
    if audio is None or audio.tags is None:
        return None
    values = audio.tags.get("RATING")
    if not values:
        return None
    return stars_from_percent(int(str(values[0]).strip()))


def _write_mp4(filepath: str, stars: int | None) -> None:
    from mutagen.mp4 import MP4

    audio = MP4(filepath)
    if stars is None:
        if audio.tags is not None and "rate" in audio.tags:
            del audio.tags["rate"]
            audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    audio.tags["rate"] = [str(percent_value(stars))]
    audio.save()


def _read_mp4(filepath: str) -> int | None:
    from mutagen.mp4 import MP4

    audio = MP4(filepath)
    if audio.tags is None:
        return None
    values = audio.tags.get("rate")
    if not values:
        return None
    return stars_from_percent(int(values[0]))
