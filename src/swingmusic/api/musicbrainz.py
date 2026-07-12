"""
Endpoints that fetch missing album covers from MusicBrainz / Cover Art Archive.

Closes: https://github.com/vwellenberg/AivinNet-Client/issues/3
"""

import logging

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from swingmusic.api.apischemas import AlbumHashSchema
from swingmusic.lib.coverart import save_album_cover_bytes
from swingmusic.lib.musicbrainz import (
    clear_failed,
    fetch_cover_for_album,
    load_failed,
    mark_failed,
    status_finish,
    status_is_running,
    status_record,
    status_reset,
    status_snapshot,
)
from swingmusic.settings import Paths
from swingmusic.store.albums import AlbumStore
from swingmusic.utils.threading import background

log = logging.getLogger(__name__)

bp_tag = Tag(
    name="MusicBrainz",
    description="Fetch missing album covers from MusicBrainz / Cover Art Archive",
)
api = APIBlueprint(
    "musicbrainz",
    __name__,
    url_prefix="/musicbrainz",
    abp_tags=[bp_tag],
)


def _album_has_cover(albumhash: str) -> bool:
    """Return True if a large cover thumbnail already exists on disk."""
    return (Paths().lg_thumb_path / f"{albumhash}.webp").exists()


def _fetch_and_save_for_albumhash(albumhash: str) -> tuple[bool, str]:
    """
    Look up an album by hash, fetch a cover from MusicBrainz/CAA and save it.

    Returns (success, message_or_filename).
    """
    entry = AlbumStore.albummap.get(albumhash)
    if entry is None:
        return False, "Album not found"

    album = entry.album
    artist_name = ""
    if album.albumartists:
        artist_name = album.albumartists[0].get("name", "") or ""

    image_bytes = fetch_cover_for_album(album.og_title or album.title, artist_name)
    if not image_bytes:
        return False, "No cover found on MusicBrainz"

    filename = save_album_cover_bytes(albumhash, image_bytes)
    if not filename:
        return False, "Cover could not be saved"

    return True, filename


class FetchCoverBody(AlbumHashSchema):
    pass


@api.post("/fetch-cover")
def fetch_cover(body: FetchCoverBody):
    """
    Fetch the album cover for the given albumhash from MusicBrainz / CAA
    and persist it as a webp thumbnail.
    """
    success, payload = _fetch_and_save_for_albumhash(body.albumhash)
    if success:
        return {"success": True, "image": payload}

    return {"success": False, "error": payload}, 404 if payload == "Album not found" else 200


class FetchMissingBody(BaseModel):
    limit: int = Field(
        default=0,
        ge=0,
        le=100000,
        description=(
            "Maximum number of albums to process in this batch. "
            "0 (the default) means process ALL albums without a cover."
        ),
    )
    retry_failed: bool = Field(
        default=False,
        description="If true, also retry albums that previously had no MusicBrainz cover.",
    )


@background
def _fetch_missing_in_background(albumhashes: list[str]) -> None:
    """
    Worker that fetches covers for the given albumhashes.
    Rate limiting is enforced inside lib.musicbrainz.
    """
    try:
        for albumhash in albumhashes:
            if _album_has_cover(albumhash):
                # Already done by an earlier run; count as success without a fetch.
                status_record(True)
                continue
            success, payload = _fetch_and_save_for_albumhash(albumhash)
            status_record(success)
            if not success:
                # Remember "no cover on MusicBrainz" so we don't retry it every
                # run. Transient/save errors are NOT cached (worth retrying).
                if payload == "No cover found on MusicBrainz":
                    mark_failed(albumhash)
                log.debug("MusicBrainz batch: %s -> %s", albumhash, payload)
    finally:
        status_finish()
        snap = status_snapshot()
        log.info(
            "MusicBrainz batch finished: %d ok, %d failed (of %d)",
            snap["fetched"],
            snap["failed"],
            snap["total"],
        )


@api.post("/fetch-missing-covers")
def fetch_missing_covers(body: FetchMissingBody):
    """
    Kick off a background job that iterates over albums without a cover and
    tries to fetch one from MusicBrainz/CAA. Returns immediately with the
    number of queued albums.

    If a batch is already running, returns 409 with the current status.
    """
    if status_is_running():
        return {
            "success": False,
            "error": "A batch is already running",
            "status": status_snapshot(),
        }, 409

    # Optionally give previously-hopeless albums another chance.
    if body.retry_failed:
        clear_failed()

    # limit == 0 means "all missing"; otherwise cap the queue at `limit`.
    # Skip albums we've already failed to find a cover for.
    failed = load_failed()
    missing: list[str] = []
    for albumhash in AlbumStore.albummap:
        if _album_has_cover(albumhash) or albumhash in failed:
            continue
        missing.append(albumhash)
        if body.limit and len(missing) >= body.limit:
            break

    if not missing:
        return {"success": True, "queued": 0, "message": "No albums without covers"}

    status_reset(total=len(missing))
    _fetch_missing_in_background(missing)
    return {"success": True, "queued": len(missing)}


@api.get("/missing-count")
def missing_count():
    """
    Return album cover stats so the frontend can label the batch button:
    - total:     all albums
    - missing:   albums with no cover on disk
    - failed:    of those, how many we already tried and MusicBrainz had none
    - remaining: missing minus failed = what a normal run would actually fetch
    """
    failed_set = load_failed()
    total = 0
    missing = 0
    failed = 0
    for albumhash in AlbumStore.albummap:
        total += 1
        if not _album_has_cover(albumhash):
            missing += 1
            if albumhash in failed_set:
                failed += 1

    return {
        "total": total,
        "missing": missing,
        "failed": failed,
        "remaining": missing - failed,
    }


@api.get("/status")
def get_status():
    """
    Return a snapshot of the running (or last completed) batch job.
    Frontend polls this every ~2s while in_progress is true.
    """
    return status_snapshot()
