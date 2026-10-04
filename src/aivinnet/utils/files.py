import mimetypes

# The audio types the stream endpoint sends, by extension — one entry per
# format in `utils.filesystem.FILES`.
#
# ⚠️ Not left to `mimetypes`: its table comes partly from /etc/mime.types, and
# the `python:3.11-slim` base image has none. Python's built-in fallback knows
# neither `.m4a` nor `.flac`, so the old `audio/{ext}` guess answered
# `audio/m4a` — not a real type. Chrome sniffs the bytes and plays anyway;
# Firefox trusts the header and refuses ("Can't load"), then drops the
# connection, which bjoern logs as `errno 32` / `errno 104`.
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
