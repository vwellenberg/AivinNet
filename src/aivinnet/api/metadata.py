"""
Fetch track metadata for an album from MusicBrainz, and apply it on request.

Three steps, deliberately separate:

    candidates -> preview -> apply

**Nothing is ever written without the preview in between.** The trackhash is
derived from title/album/artists, so correcting a title changes a track's
identity across playlists, favourites and history (`lib/track_edit.py` migrates
those, but it cannot un-write a wrong title). And a wrong release is not an
obvious failure — it produces a tidy, plausible, wrong track list that nobody
ever goes back to check. So the person picks the release, sees old and new side
by side, and chooses what to apply.

`apply` takes the values the client was shown rather than looking them up
again: what you confirmed is exactly what gets written, with no second request
that could answer differently.

The two lookups run off the request thread — see `lib/mbjobs.py` for why that
is not optional here.
"""

import logging
import threading

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import AlbumHashSchema
from aivinnet.api.auth import admin_required
from aivinnet.lib import filename_meta, mbjobs
from aivinnet.lib.mbrelease import fetch_release_tracks, search_releases
from aivinnet.lib.track_edit import TrackEditError, TrackNotFoundError, edit_track_tags_by_filepath
from aivinnet.lib.track_match import LocalTrack, align, order_local, track_numbers_are_useless
from aivinnet.store.albums import AlbumStore
from aivinnet.store.tracks import TrackStore

log = logging.getLogger(__name__)

bp_tag = Tag(
    name="Metadata",
    description="Fetch track metadata for an album from MusicBrainz and apply it",
)
api = APIBlueprint("metadata", __name__, url_prefix="/metadata", abp_tags=[bp_tag])


def _spawn(job_id: str, work, *, writes: bool) -> None:
    """
    Run `work` on its own thread.

    ⚠️ `writes` decides whether the thread is a daemon, and it is not a detail.
    A daemon thread is abandoned at exit: fine for a lookup, which holds nothing
    but a socket and an in-memory slot. For a thread in the middle of writing
    tags and touching the database it is not — a daemon caught inside SQLite at
    exit takes the process down with SIGSEGV and leaves the WAL behind (the
    shutdown notes in CLAUDE.md). So an apply keeps the process alive until it
    is finished.
    """
    thread = threading.Thread(target=mbjobs.run, args=(job_id, work), daemon=not writes)
    thread.start()


def _album_or_none(albumhash: str):
    entry = AlbumStore.albummap.get(albumhash)
    return entry.album if entry else None


def _local_tracks(albumhash: str) -> list[LocalTrack]:
    """The album's tracks, in the order the album is meant to play in."""
    tracks = [
        LocalTrack(
            trackhash=t.trackhash,
            filepath=t.filepath,
            title=t.title,
            track=t.track or 0,
            disc=t.disc or 1,
            duration=t.duration or 0,
        )
        for t in TrackStore.get_tracks_by_albumhash(albumhash)
    ]
    return order_local(tracks)


class AlbumCandidatesBody(AlbumHashSchema):
    pass


@api.post("/album/candidates")
@admin_required()
def album_candidates(body: AlbumCandidatesBody):
    """
    Start a search for releases that could be this album.

    Returns a job id immediately; poll `/metadata/job/<job_id>` for the list.
    """
    album = _album_or_none(body.albumhash)
    if album is None:
        return {"error": "Album not found"}, 404

    title = album.og_title or album.title
    artist = ""
    if album.albumartists:
        artist = album.albumartists[0].get("name", "") or ""

    job_id = mbjobs.create()
    _spawn(
        job_id,
        lambda: {"candidates": [c.todict() for c in search_releases(title, artist)]},
        writes=False,
    )
    return {"job": job_id}


# INFO: Two sources, and the second one is not a consolation prize.
#
# Measured on this library: "The Guild 2" has 94 tracks, every file tagged
# `track 1` with the number as its title, and the real titles in the file names
# ("68. Night Woods1.mp3"). MusicBrainz answers ZERO candidates for it, under
# either name — a game soundtrack rip is not in their database. An album like
# that is repairable from its file names and from nothing else, so offering only
# MusicBrainz would have left the exact case this feature was asked for
# untouched.
MUSICBRAINZ = "musicbrainz"
FILENAMES = "filenames"


class AlbumPreviewBody(AlbumHashSchema):
    source: str = Field(
        MUSICBRAINZ,
        description=f"Where the proposal comes from: '{MUSICBRAINZ}' or '{FILENAMES}'",
    )
    mbid: str | None = Field(None, description="The MusicBrainz release to compare against")


def _preview_from_filenames(albumhash: str) -> dict:
    """
    Propose a number and a title per file, read off its own name.

    No alignment: each file speaks for itself, so there is no gap to slide on
    and nothing to pair. That also makes it the safer of the two sources — the
    worst case is a proposal that reads wrong next to the current value, where a
    mismatched release can be wrong in a way that looks right.
    """
    rows = []
    proposals = 0

    for track in _local_tracks(albumhash):
        number, title = filename_meta.parse(track.filepath)

        proposed = None
        if number is not None or title is not None:
            proposals += 1
            proposed = {
                # Only what the file name actually said. A None here means the
                # client shows no change for that field, not an empty value.
                "title": title,
                "track": number,
                "disc": None,
                "duration": track.duration,
            }

        rows.append(
            {
                "current": {
                    "trackhash": track.trackhash,
                    "filepath": track.filepath,
                    "title": track.title,
                    "track": track.track,
                    "disc": track.disc,
                    "duration": track.duration,
                },
                "proposed": proposed,
                "delta": None,
                # The file name is evidence about naming, never about identity,
                # so it makes no claim the way a duration match does.
                "confident": False,
            }
        )

    return {
        "rows": rows,
        "summary": {
            "matched": proposals,
            "confident": 0,
            "unmatched_local": len(rows) - proposals,
            "unmatched_remote": 0,
            "ordered_by_filepath": True,
        },
    }


def _preview(albumhash: str, mbid: str | None, source: str = MUSICBRAINZ) -> dict:
    if source == FILENAMES:
        return _preview_from_filenames(albumhash)

    # Read once. Two reads of a mutable global can disagree — the rows would
    # then come from one version of the album and the ordering note from
    # another.
    local = _local_tracks(albumhash)
    remote = fetch_release_tracks(mbid or "")

    if not remote:
        return {"error": "The release has no track list", "rows": []}

    result = align(local, remote)

    rows = []
    for pairing in result.pairings:
        current = None
        if pairing.local is not None:
            current = {
                "trackhash": pairing.local.trackhash,
                "filepath": pairing.local.filepath,
                "title": pairing.local.title,
                "track": pairing.local.track,
                "disc": pairing.local.disc,
                "duration": pairing.local.duration,
            }

        proposed = None
        if pairing.remote is not None:
            proposed = {
                "title": pairing.remote.title,
                "track": pairing.remote.position,
                "disc": pairing.remote.disc,
                "duration": round((pairing.remote.length or 0) / 1000),
            }

        rows.append(
            {
                "current": current,
                "proposed": proposed,
                "delta": pairing.delta,
                "confident": pairing.confident,
            }
        )

    return {
        "rows": rows,
        "summary": {
            "matched": result.matched_count,
            "confident": result.confident_count,
            "unmatched_local": result.unmatched_local,
            "unmatched_remote": result.unmatched_remote,
            # Worth saying out loud in the UI: with every file numbered the
            # same, the order comes from the file paths, and that is a guess
            # the person should get to sanity-check.
            "ordered_by_filepath": track_numbers_are_useless(local),
        },
    }


@api.post("/album/preview")
@admin_required()
def album_preview(body: AlbumPreviewBody):
    """
    Start a comparison of this album against a release — or against what its
    own file names say, which for a rip MusicBrainz has never heard of is the
    only source there is.

    Returns a job id immediately; poll `/metadata/job/<job_id>` for the rows.
    Writes nothing.
    """
    if _album_or_none(body.albumhash) is None:
        return {"error": "Album not found"}, 404

    if body.source not in (MUSICBRAINZ, FILENAMES):
        return {"error": f"Unknown source {body.source!r}"}, 400

    if body.source == MUSICBRAINZ and not body.mbid:
        return {"error": "A MusicBrainz preview needs a release"}, 400

    job_id = mbjobs.create()
    _spawn(job_id, lambda: _preview(body.albumhash, body.mbid, body.source), writes=False)
    return {"job": job_id}


class TrackChange(BaseModel):
    # ⚠️ The FILE, not the trackhash. A trackhash is derived from
    # title/album/artists and is therefore not unique: an album whose files all
    # say "Track 1" has exactly ONE of them, so a batch addressed by hash would
    # hand N different titles to `get_best()` and let it decide which file gets
    # which. That is the very shape of album this feature exists to repair.
    # A path is unique and does not move when tags change.
    filepath: str = Field(..., description="The file to change")
    title: str | None = Field(None, description="New track title")
    track: int | None = Field(None, description="New track number", ge=0)
    disc: int | None = Field(None, description="New disc number", ge=0)


class AlbumApplyBody(BaseModel):
    changes: list[TrackChange] = Field(..., description="Exactly the changes the user confirmed")


# INFO: One apply at a time, server-wide. A second one is not a slower version
# of the first: both threads walk `edit_track_tags_by_filepath`, which rewrites
# the album and artist maps, and the later one finds tracks whose hashes the
# earlier already changed — so a double-click reports half an album as failed
# while it actually succeeded. The cover batch next door guards the same way.
_apply_lock = threading.Lock()
_applying = False


def _apply(changes: list[TrackChange]) -> dict:
    applied = []
    failed = []

    for change in changes:
        fields = change.model_dump(exclude_none=True)
        fields.pop("filepath", None)
        if not fields:
            continue

        try:
            track = edit_track_tags_by_filepath(change.filepath, fields)
        except TrackNotFoundError:
            failed.append({"filepath": change.filepath, "error": "Track not found"})
            continue
        except TrackEditError as e:
            failed.append({"filepath": change.filepath, "error": str(e)})
            continue

        # The hash changes whenever the title did, so the client needs the new
        # one to keep talking about the same track.
        applied.append({"filepath": change.filepath, "new_trackhash": track.trackhash})

    return {"applied": applied, "failed": failed}


@api.post("/album/apply")
@admin_required()
def album_apply(body: AlbumApplyBody):
    """
    Write the confirmed changes to the audio files.

    Each track goes through `edit_track_tags`, which backs the file up, writes,
    reindexes and repoints playlist/favourite/history references — and restores
    the backup if any of that fails. One track failing does not stop the rest;
    the response lists both outcomes.

    Returns a job id immediately; poll `/metadata/job/<job_id>`.
    """
    global _applying

    if not body.changes:
        return {"error": "Nothing to apply"}, 400

    with _apply_lock:
        if _applying:
            return {"error": "An apply is already running"}, 409
        _applying = True

    changes = list(body.changes)
    job_id = mbjobs.create()
    _spawn(job_id, lambda: _run_apply(changes), writes=True)
    return {"job": job_id}


def _run_apply(changes: list[TrackChange]) -> dict:
    """The worker: releases the claim whatever happens, or nothing runs again."""
    global _applying

    try:
        return _apply(changes)
    finally:
        with _apply_lock:
            _applying = False


class JobPath(BaseModel):
    job_id: str = Field(..., description="The job id returned by a lookup or apply")


@api.get("/job/<job_id>")
@admin_required()
def job_status(path: JobPath):
    """
    Where a lookup or apply has got to, and its result once it has one.

    Admin-only like the routes that create these jobs: a preview carries the
    absolute file paths of the library, which is not something an ordinary
    account gets to read off a guessed id.
    """
    snap = mbjobs.snapshot(path.job_id)
    if snap is None:
        return {"error": "Unknown job"}, 404

    return snap
