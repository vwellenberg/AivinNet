"""
Endpoints that fetch missing album covers from MusicBrainz / Cover Art Archive.

Closes: https://github.com/vwellenberg/AivinNet-Client/issues/3
"""

import logging
import threading
import time
from io import BytesIO

from flask_openapi3 import APIBlueprint, Tag
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from swingmusic.api.apischemas import AlbumHashSchema
from swingmusic.lib.musicbrainz import fetch_cover_for_album
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
        default=50,
        ge=1,
        le=500,
        description="Maximum number of albums to process in this batch.",
    )


# INFO: Module-global batch status. The frontend polls /status to render a
# progress bar. A lock guards every read/write so a polling request sees a
# consistent snapshot (no torn values like fetched > total).
_status_lock = threading.Lock()
_batch_status: dict = {
    "in_progress": False,
    "total": 0,
    "fetched": 0,
    "failed": 0,
    "started_at": None,
    "finished_at": None,
}


def _status_snapshot() -> dict:
    with _status_lock:
        return dict(_batch_status)


def _status_reset(total: int) -> None:
    with _status_lock:
        _batch_status["in_progress"] = True
        _batch_status["total"] = total
        _batch_status["fetched"] = 0
        _batch_status["failed"] = 0
        _batch_status["started_at"] = time.time()
        _batch_status["finished_at"] = None


def _status_record(success: bool) -> None:
    with _status_lock:
        if success:
            _batch_status["fetched"] += 1
        else:
            _batch_status["failed"] += 1


def _status_finish() -> None:
    with _status_lock:
        _batch_status["in_progress"] = False
        _batch_status["finished_at"] = time.time()


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
                _status_record(True)
                continue
            success, payload = _fetch_and_save_for_albumhash(albumhash)
            _status_record(success)
            if not success:
                log.debug("MusicBrainz batch: %s -> %s", albumhash, payload)
    finally:
        _status_finish()
        snap = _status_snapshot()
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
    with _status_lock:
        if _batch_status["in_progress"]:
            return {
                "success": False,
                "error": "A batch is already running",
                "status": dict(_batch_status),
            }, 409

    missing: list[str] = []
    for albumhash in AlbumStore.albummap:
        if not _album_has_cover(albumhash):
            missing.append(albumhash)
            if len(missing) >= body.limit:
                break

    if not missing:
        return {"success": True, "queued": 0, "message": "No albums without covers"}

    _status_reset(total=len(missing))
    _fetch_missing_in_background(missing)
    return {"success": True, "queued": len(missing)}


@api.get("/status")
def get_status():
    """
    Return a snapshot of the running (or last completed) batch job.
    Frontend polls this every ~2s while in_progress is true.
    """
    return _status_snapshot()
