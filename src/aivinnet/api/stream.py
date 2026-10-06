"""
Contains all the track routes.
"""

import io
import os
from pathlib import Path

from flask import request, send_file, send_from_directory
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field
from werkzeug.exceptions import RequestedRangeNotSatisfiable

from aivinnet.api.apischemas import TrackHashSchema
from aivinnet.config import UserConfig
from aivinnet.lib.trackslib import get_silence_paddings
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.files import flac_audio_offset, guess_mime_type

bp_tag = Tag(name="File", description="Audio files")
api = APIBlueprint("track", __name__, url_prefix="/file", abp_tags=[bp_tag])


class SendTrackFileQuery(BaseModel):
    filepath: str = Field(description="The filepath to play (if available)")


@api.get("/<trackhash>/legacy")
def send_track_file_legacy(path: TrackHashSchema, query: SendTrackFileQuery):
    """
    Get a playable audio file

    Returns a playable audio file that corresponds to the given filepath. Falls back to track hash if filepath is not found.

    NOTE: Files are sent as they are on disk; there is no transcoding.
    """
    requested_trackhash = path.trackhash.strip()
    filepath = query.filepath.strip()

    msg = {"msg": "File Not Found"}

    # prevent path traversal
    if "/../" in filepath:
        return {"msg": "Invalid filepath", "error": "Path traversal detected"}, 400

    requested_filepath = Path(filepath).resolve()

    # The file must sit under ANY one root dir. This loop used to answer 400 at
    # the first root that did NOT contain it, i.e. it demanded ALL roots — so
    # with two music folders every single track was refused.
    roots = (Path.home() if r == "$home" else Path(r).resolve() for r in UserConfig().rootDirs)

    if not any(root in requested_filepath.parents for root in roots):
        return {
            "msg": "Invalid filepath",
            "error": "File not inside root directories",
        }, 400

    track = None
    # By hash: one dict lookup. Asking by path walked the whole store, and
    # this runs for every ranged chunk of every song (#295).
    group = TrackStore.trackhashmap.get(requested_trackhash)

    for t in group.tracks if group else ():
        if t.filepath == filepath and os.path.exists(t.filepath):
            track = t
            break

    # INFO: A path that names a DIFFERENT track is as stale as a missing one.
    # Renaming a renumbered album (#144) hands old names to other files, so a
    # queue saved before the rename asks for this track under a name another
    # track now carries. The hash still identifies it — look that up rather
    # than answer 404 (sending the file at the path would play the wrong song).
    if track is None:
        group = TrackStore.trackhashmap.get(requested_trackhash)

        # When finding by trackhash, sort by bitrate
        # and get the first track that exists
        if group is not None:
            tracks = sorted(group.tracks, key=lambda x: x.bitrate, reverse=True)

            for t in tracks:
                if os.path.exists(t.filepath):
                    track = t
                    break

    if track is not None:
        audio_type = guess_mime_type(track.filepath)

        offset = flac_audio_offset(track.filepath) if audio_type == "audio/flac" else 0
        if offset:
            return _send_from_offset(track.filepath, offset, audio_type)

        return send_from_directory(
            Path(track.filepath).parent,
            Path(track.filepath).name,
            mimetype=audio_type,
            conditional=True,
            as_attachment=True,
        )

    return msg, 404


class _FileFromOffset(io.RawIOBase):
    """A read-only view of a file that starts `offset` bytes in."""

    def __init__(self, path: str, offset: int):
        self._raw = open(path, "rb")  # noqa: SIM115 — the response closes it
        self._offset = offset
        self._raw.seek(offset)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self._raw.tell() - self._offset

    def seek(self, pos, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            return self._raw.seek(self._offset + pos) - self._offset
        return self._raw.seek(pos, whence) - self._offset

    def readinto(self, buffer):
        return self._raw.readinto(buffer)

    def fileno(self):
        return self._raw.fileno()

    def close(self):
        self._raw.close()
        super().close()


def _send_from_offset(filepath: str, offset: int, mimetype: str):
    """
    Sends a file from `offset` on, with the same Range/conditional handling as
    the plain path — seeking has to keep working, and every browser asks with
    a Range header.

    Used for FLAC files with an ID3v2 tag in front of `fLaC`: Firefox refuses
    those outright (see `flac_audio_offset`).
    """
    stat = os.stat(filepath)
    size = stat.st_size - offset

    view = _FileFromOffset(filepath, offset)
    response = send_file(
        view,
        mimetype=mimetype,
        as_attachment=True,
        download_name=Path(filepath).name,
        conditional=False,
        etag=f"{stat.st_mtime}-{stat.st_size}-{offset}",
        last_modified=stat.st_mtime,
    )
    response.content_length = size
    try:
        return response.make_conditional(request.environ, accept_ranges=True, complete_length=size)
    except RequestedRangeNotSatisfiable:
        view.close()
        raise


class GetAudioSilenceBody(BaseModel):
    ending_file: str = Field(description="The ending file's path")
    starting_file: str = Field(description="The beginning file's path")


@api.post("/silence")
def get_audio_silence(body: GetAudioSilenceBody):
    """
    Get silence paddings

    Returns the duration of silence at the end of the current ending track and the duration of silence at the beginning of the next track.

    NOTE: Durations are in milliseconds.
    """
    ending_file = body.ending_file  # ending file's filepath
    starting_file = body.starting_file  # starting file's filepath

    if ending_file is None or starting_file is None:
        return {"msg": "No filepath provided"}, 400

    return get_silence_paddings(ending_file, starting_file)
