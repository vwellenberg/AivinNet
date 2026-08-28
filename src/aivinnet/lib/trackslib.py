"""
This library contains all the functions related to tracks.
"""

import os
import pathlib

from aivinnet.lib.pydub.pydub import AudioSegment
from aivinnet.lib.pydub.pydub.silence import detect_leading_silence, detect_silence
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.threading import ProcessWithReturnValue


def get_leading_silence_end(filepath: pathlib.Path):
    """
    Returns the leading silence of a track.
    """
    format = filepath.suffix.replace(".", "")
    try:
        audio = AudioSegment.from_file(filepath, format=format)
        silence = detect_leading_silence(audio, silence_threshold=-40.0, chunk_size=10)
    except Exception:
        return 0

    return silence if silence > 1000 else 0


def get_trailing_silence_start(filepath: str):
    """
    Returns the trailing silence of a track.
    """
    format = filepath.suffix.replace(".", "")

    try:
        audio = AudioSegment.from_file(filepath, format=format)
        duration = len(audio)
    except Exception:
        return None

    audio = audio[-30000:] if len(audio) > 30000 else audio
    silence_groups = detect_silence(audio, silence_thresh=-40.0, seek_step=10)

    if len(silence_groups) == 0:
        return duration

    silence_group = silence_groups[-1]
    is_ok = silence_group[1] == len(audio)

    if is_ok:
        return duration - (silence_group[1] - silence_group[0])

    return duration


def get_silence_paddings(ending_file: str, starting_file: str):
    """
    Returns the ending silence of a track and the starting silence of the next.
    """
    # ⚠️ Both paths arrive straight from a request body, and what happens next is
    # `.exists()` followed by spawning a process that decodes the whole file. That
    # made the endpoint two things at once: an oracle telling any logged-in
    # account whether an arbitrary path exists on the server, and — because the
    # handler blocks on join() while bjoern serves one request at a time — a way
    # to stop the entire app with a single call on a large file.
    #
    # Checked HERE rather than only in the handler: this is a library function
    # that spawns processes on whatever it is handed, and it should not depend on
    # its caller having validated. Same reasoning as lib/loginguard.py.
    if not is_indexed_track_path(str(starting_file)) or not is_indexed_track_path(str(ending_file)):
        return {"starting_file": 0, "ending_file": 0}

    starting_file = pathlib.Path(starting_file)
    ending_file = pathlib.Path(ending_file)

    silence = {"starting_file": 0, "ending_file": 0}
    ending_thread = None
    starting_thread = None

    if ending_file.exists():
        ending_thread = ProcessWithReturnValue(target=get_trailing_silence_start, args=(ending_file,))
        ending_thread.start()

    if os.path.exists(starting_file):
        starting_thread = ProcessWithReturnValue(target=get_leading_silence_end, args=(starting_file,))
        starting_thread.start()

    if ending_thread:
        silence["ending_file"] = ending_thread.join()

    if starting_thread:
        silence["starting_file"] = starting_thread.join()

    return silence


def is_indexed_track_path(filepath: str) -> bool:
    """
    Whether this exact path belongs to a track the library has indexed.

    The one question worth asking before the server touches a path that arrived
    in a request. Membership of the store is a much tighter answer than "is it
    under a root directory": the indexer already decided this is an audio file
    the owner pointed us at.
    """
    if not filepath:
        return False

    return bool(TrackStore.get_tracks_by_filepaths([filepath]))


def resolve_track_filepath(trackhash: str, requested: str | None = None) -> str | None:
    """
    Turn a trackhash into a real file on disk.

    A `requested` path is honoured only when it is one of the files that very
    trackhash resolves to — which is what a legitimate client sends, so nothing
    changes for them. Anything else falls back to the track's own best file, and
    an unknown hash returns None.

    ⚠️ The point is that the caller never gets to name a path the server then
    writes to or decodes. One trackhash can map to several files (the same song
    in different formats), which is why the requested path is worth honouring at
    all rather than always picking for them.
    """
    group = TrackStore.trackhashmap.get(trackhash)

    if group is None:
        return None

    if requested:
        requested = requested.strip()
        if any(t.filepath == requested for t in group.tracks) and os.path.exists(requested):
            return requested

    for track in sorted(group.tracks, key=lambda t: t.bitrate, reverse=True):
        if os.path.exists(track.filepath):
            return track.filepath

    return None
