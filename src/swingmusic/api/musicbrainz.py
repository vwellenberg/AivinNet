"""
Endpoints that fetch missing album covers from MusicBrainz / Cover Art Archive.

Closes: https://github.com/vwellenberg/AivinNet-Client/issues/3
"""

import logging
from io import BytesIO

from flask_openapi3 import APIBlueprint, Tag
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from swingmusic.api.apischemas import AlbumHashSchema
from swingmusic.lib.musicbrainz import (
    fetch_cover_for_album,
    status_finish,
    status_is_running,
    status_record,
    status_reset,
    status_snapshot,
)
from swingmusic.settings import Defaults, Paths
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


def _save_cover_bytes(albumhash: str, image_bytes: bytes) -> str | None:
    """
    Persist the downloaded image as a webp in all thumbnail sizes
    used by the image server.

    Returns the filename ('<albumhash>.webp') on success, otherwise None.
    """
    try:
        img = Image.open(BytesIO(image_bytes))
    except (UnidentifiedImageError, OSError) as e:
        log.warning("MusicBrainz cover for %s could not be decoded: %s", albumhash, e)
        return None

    filename = f"{albumhash}.webp"
    paths = Paths()
    targets = [
        (paths.lg_thumb_path / filename, Defaults.LG_THUMB_SIZE),
        (paths.md_thumb_path / filename, Defaults.MD_THUMB_SIZE),
        (paths.sm_thumb_path / filename, Defaults.SM_THUMB_SIZE),
        (paths.xsm_thumb_path / filename, Defaults.XSM_THUMB_SIZE),
    ]

    try:
        width, height = img.size
        ratio = (width / height) if height else 1.0

        def _save_all(source: Image.Image) -> None:
            for path, size in targets:
                path.parent.mkdir(parents=True, exist_ok=True)
                resized = source.resize((size, max(1, int(size / ratio))), Image.LANCZOS)
                resized.save(path, "webp")
                resized.close()

        try:
            _save_all(img)
        except OSError:
            # INFO: webp can fail on RGBA/P-mode source images; fall back to RGB.
            rgb = img.convert("RGB")
            try:
                _save_all(rgb)
            finally:
                rgb.close()
    except (OSError, ValueError) as e:
        log.warning("Saving MusicBrainz cover for %s failed: %s", albumhash, e)
        return None
    finally:
        img.close()

    return filename


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

    filename = _save_cover_bytes(albumhash, image_bytes)
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

    # limit == 0 means "all missing"; otherwise cap the queue at `limit`.
    missing: list[str] = []
    for albumhash in AlbumStore.albummap:
        if not _album_has_cover(albumhash):
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
    Return how many albums currently have no cover on disk, plus the total
    album count. The frontend uses this to label the batch button.
    """
    total = 0
    missing = 0
    for albumhash in AlbumStore.albummap:
        total += 1
        if not _album_has_cover(albumhash):
            missing += 1

    return {"total": total, "missing": missing}


@api.get("/status")
def get_status():
    """
    Return a snapshot of the running (or last completed) batch job.
    Frontend polls this every ~2s while in_progress is true.
    """
    return status_snapshot()
