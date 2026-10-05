import mimetypes

# The audio types the stream endpoint sends, by extension — one entry per
# format in `utils.filesystem.FILES`.
#
# Not left to `mimetypes`: its table comes partly from /etc/mime.types, and
# the `python:3.11-slim` base image has none. Python's built-in fallback knows
# neither `.m4a` nor `.flac`, so the old `audio/{ext}` guess answered
# `audio/m4a` — not a real type. Measured on 2026-10-04 (Firefox 142,
# Chromium 141, WebKit 26), no browser cared: each plays or refuses a file by
# its codec, not by this header. The table is about sending the right type,
# not about playback — which formats play where: .claude/rules/api-endpoints.md.
AUDIO_MIME_TYPES = {
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    # ALAC lives in an MP4 container, whatever the extension says.
    "alac": "audio/mp4",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
    "wma": "audio/x-ms-wma",
    "aiff": "audio/aiff",
}


def guess_mime_type(filename: str):
    """
    Guess the mime type of a file.
    """
    ext = filename.rsplit(".", maxsplit=1)[-1].lower()

    if ext in AUDIO_MIME_TYPES:
        return AUDIO_MIME_TYPES[ext]

    type = mimetypes.guess_type(filename)[0]

    if type is None:
        return f"audio/{ext}"

    return type


# The ID3v2 header: "ID3", version (2 bytes), flags (1), syncsafe size (4).
_ID3_HEADER_SIZE = 10
_ID3_FOOTER_FLAG = 0x10
# Stacked tags are rare; a bound keeps a malformed file from looping.
_ID3_MAX_STACKED = 4


def flac_audio_offset(path: str) -> int:
    """
    Where the FLAC stream (`fLaC`) starts when ID3v2 tags were put in front
    of it, else 0.

    ⚠️ FLAC has no ID3 — but some taggers write an ID3v2 tag before the
    `fLaC` marker anyway. Chrome, Edge and Safari skip it; Firefox does not
    and refuses the whole file ("could not be decoded",
    NS_ERROR_DOM_MEDIA_METADATA_ERR), track after track. The stream endpoint
    therefore sends such a file from this offset on; the file on disk is not
    touched. Anything that does not end in `fLaC` exactly where the tags say
    is left alone (0): better an unchanged file than a guessed cut.
    """
    try:
        with open(path, "rb") as f:
            offset = 0
            for _ in range(_ID3_MAX_STACKED):
                f.seek(offset)
                header = f.read(_ID3_HEADER_SIZE)
                if len(header) < _ID3_HEADER_SIZE or header[:3] != b"ID3":
                    break

                size_bytes = header[6:10]
                if any(b & 0x80 for b in size_bytes):
                    return 0  # not a syncsafe integer: not a real ID3 tag

                size = 0
                for b in size_bytes:
                    size = (size << 7) | b

                offset += _ID3_HEADER_SIZE + size
                if header[5] & _ID3_FOOTER_FLAG:
                    offset += _ID3_HEADER_SIZE

            if offset == 0:
                return 0

            f.seek(offset)
            return offset if f.read(4) == b"fLaC" else 0
    except OSError:
        return 0
