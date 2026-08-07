"""
Endpoints that fetch missing album covers from MusicBrainz / Cover Art Archive.

Closes: https://github.com/vwellenberg/AivinNet-Client/issues/3
"""

import logging

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import AlbumHashSchema
from aivinnet.lib.coverart import fetch_verified_cover, save_album_cover_bytes
from aivinnet.lib.musicbrainz import (
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
from aivinnet.settings import Paths
from aivinnet.store.albums import AlbumStore
from aivinnet.utils.threading import background

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


# INFO: The one outcome that is worth remembering between runs — "we looked
# everywhere and there is nothing". A constant rather than a literal because the
# batch worker below compares against it to decide whether to write the negative
# cache: as two separate string literals, adding a source to the chain would
# have silently stopped that cache from ever being written again.
NO_COVER_FOUND = "No cover found online"


def _fetch_and_save_for_albumhash(albumhash: str) -> tuple[bool, str]:
    """
    Look up an album by hash, fetch a cover online and save it.

    The chain is MusicBrainz/CAA first, then the iTunes/Deezer stores. That
    order is deliberate: MusicBrainz is searched by exact-phrase title and
    answers with a relevance score, so a hit there is the better-evidenced one.
    The stores answer with *something* for almost any query, which is why they
    come second and why their candidates have to clear an explicit title+artist
    check (see lib/coverart.fetch_verified_cover) rather than a score.

    Returns (success, message_or_filename).
    """
    entry = AlbumStore.albummap.get(albumhash)
    if entry is None:
        return False, "Album not found"

    album = entry.album
    artist_name = ""
    if album.albumartists:
        artist_name = album.albumartists[0].get("name", "") or ""

    title = album.og_title or album.title

    image_bytes = fetch_cover_for_album(title, artist_name)
    if not image_bytes:
        image_bytes = fetch_verified_cover(title, artist_name)

    if not image_bytes:
        return False, NO_COVER_FOUND

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
                # Remember "no source had a cover we could verify" so we don't
                # retry it every run. Transient/save errors are NOT cached
                # (worth retrying).
                if payload == NO_COVER_FOUND:
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
