"""
Write metadata tags back to audio files using mutagen.

P1 scope: text tags only (title, artists, album, album artists, track number).
Cover-art editing is intentionally deferred to P1b because it is format-specific
(ID3 ``APIC`` / MP4 ``covr`` / FLAC ``picture``) and needs per-container testing.

Round-trip note: ``taglib.get_tags`` reads artists/album-artists as a single raw
string and the ``Track`` model later re-splits it via ``split_artists`` (which
always splits on commas, regardless of the user's configured separators). So we
write multiple artists as one comma-joined value, guaranteeing the reindex
splits them back into the intended list.
"""

from __future__ import annotations

import mutagen

# Our field name -> mutagen "easy" tag key. Easy mode gives a uniform mapping
# across MP3 (EasyID3), FLAC/OGG (VComment) and MP4 (EasyMP4).
_EASY_KEYS = {
    "title": "title",
    "album": "album",
    "artists": "artist",
    "albumartists": "albumartist",
    "track": "tracknumber",
}

# Fields that must not be written empty (they feed the trackhash / album identity).
_REQUIRED_NON_EMPTY = {"title", "album", "artists"}


class TagWriteError(Exception):
    """Raised when tags cannot be written to a file."""


def _easy_value(field: str, value) -> list[str]:
    """Convert an incoming field value to the list[str] mutagen easy tags expect."""
    if field in ("artists", "albumartists"):
        names = [str(v).strip() for v in value if str(v).strip()]
        return [", ".join(names)]

    return [str(value).strip()]


def _validate(fields: dict) -> None:
    for field in _REQUIRED_NON_EMPTY:
        if field not in fields:
            continue

        value = fields[field]
        if field == "artists":
            cleaned = [str(v).strip() for v in (value or []) if str(v).strip()]
            if not cleaned:
                raise TagWriteError("At least one artist is required")
        elif not str(value).strip():
            raise TagWriteError(f"'{field}' must not be empty")


def write_tags(filepath: str, fields: dict) -> None:
    """
    Write the given metadata fields to the audio file at ``filepath``.

    :param filepath: Path to the audio file.
    :param fields: Mapping of field name -> new value. Recognised text fields are
        ``title``, ``album`` (str), ``artists``, ``albumartists`` (list[str]) and
        ``track`` (int). Unknown keys (e.g. a future ``cover``) are ignored here.
    :raises TagWriteError: If the file is unsupported/unreadable or a required
        field is empty.
    """
    _validate(fields)

    try:
        audio = mutagen.File(filepath, easy=True)
    except Exception as exc:  # mutagen raises various per-format errors
        raise TagWriteError(f"Could not read audio file: {exc}") from exc

    if audio is None:
        raise TagWriteError(f"Unsupported audio file: {filepath}")

    if audio.tags is None:
        try:
            audio.add_tags()
        except Exception as exc:
            raise TagWriteError(f"Could not initialise tags: {exc}") from exc

    wrote_any = False
    for field, value in fields.items():
        key = _EASY_KEYS.get(field)
        if key is None:
            continue

        try:
            audio[key] = _easy_value(field, value)
        except Exception as exc:
            raise TagWriteError(f"Could not set '{field}': {exc}") from exc

        wrote_any = True

    if not wrote_any:
        return

    try:
        audio.save()
    except Exception as exc:
        raise TagWriteError(f"Could not save tags: {exc}") from exc
