"""
Contains all the track routes.
"""

import os
from pathlib import Path

from flask import send_from_directory
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import TrackHashSchema
from aivinnet.config import UserConfig
from aivinnet.lib.trackslib import get_silence_paddings
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.files import guess_mime_type

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

    # check if filepath is a child of any of the root dirs
    for root_dir in UserConfig().rootDirs:
        if root_dir == "$home":
            root_dir = Path.home()
        else:
            root_dir = Path(root_dir).resolve()

        if root_dir not in requested_filepath.parents:
            return {
                "msg": "Invalid filepath",
                "error": "File not inside root directories",
            }, 400

    track = None
    tracks = TrackStore.get_tracks_by_filepaths([filepath])

    for t in tracks:
        if os.path.exists(t.filepath) and t.trackhash == requested_trackhash:
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
        return send_from_directory(
            Path(track.filepath).parent,
            Path(track.filepath).name,
            mimetype=audio_type,
            conditional=True,
            as_attachment=True,
        )

    return msg, 404


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
