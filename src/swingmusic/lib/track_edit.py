"""
Edit a track's metadata tags while keeping the library and references consistent.

P1 scope: text tags only (cover art is P1b). Because the trackhash is derived
from title/album/artist, editing those fields changes the track's identity. The
flow therefore is: back up the file, write the new tags, reindex the single file
(capturing the old and new trackhash from the in-memory store), reconcile the
affected album/artist maps, then repoint all playlist/favorite/history
references from the old hash to the new one. Any failure restores the backup and
re-indexes the original file so the store/DB and references stay in sync.

Note: ``watchdogg.remove_track`` is dead/broken in this fork (references an
undefined ``db`` symbol and removed store helpers), so removal of the old DB row
and the in-memory map cleanup are done explicitly here instead.
"""

from __future__ import annotations

import logging
import os
import shutil

from swingmusic.config import UserConfig
from swingmusic.db.libdata import TrackTable
from swingmusic.db.utils import track_to_dataclass
from swingmusic.lib import tag_writer
from swingmusic.lib.reference_migration import migrate_track_references
from swingmusic.lib.tagger import create_albums, create_artists
from swingmusic.lib.taglib import extract_thumb, get_tags
from swingmusic.models import Track
from swingmusic.store.albums import AlbumStore
from swingmusic.store.artists import ArtistMapEntry, ArtistStore
from swingmusic.store.tracks import TrackStore

# NOTE: do not use `from swingmusic.logger import log` — that global is None until
# setup_logger() runs and the imported name never picks up the reassignment.
log = logging.getLogger(__name__)

# Fields accepted from the API. tag_writer ignores anything it doesn't recognise.
EDITABLE_FIELDS = {"title", "artists", "albumartists", "album", "track"}


class TrackEditError(Exception):
    """Raised when a track's tags cannot be edited."""


class TrackNotFoundError(TrackEditError):
    """Raised when the track to edit cannot be found in the store."""


def _identity_artist_hashes(track: Track) -> set[str]:
    """All artisthashes that identify a track: performing artists + album artists."""
    hashes = set(track.artisthashes or [])
    for artist in track.albumartists:
        hashes.add(artist["artisthash"])
    return hashes


def _reconcile_album(albumhash: str) -> None:
    """Rebuild an album map entry from current store truth, or drop it if empty."""
    tracks = TrackStore.get_tracks_by_albumhash(albumhash)
    if not tracks:
        AlbumStore.albummap.pop(albumhash, None)
        return

    existing = AlbumStore.albummap.get(albumhash)
    for album, trackhashes in create_albums([t.trackhash for t in tracks]):
        if album.albumhash != albumhash:
            continue

        if existing is not None and existing.album.color:
            album.color = existing.album.color

        AlbumStore.index_new_album(album, trackhashes)
        return


def _artist_still_referenced(artisthash: str) -> bool:
    """Whether any track still lists this artist as a performer or album artist."""
    for track in TrackStore.get_flat_list():
        if artisthash in track.artisthashes:
            return True
        if any(a["artisthash"] == artisthash for a in track.albumartists):
            return True
    return False


def _reconcile_artist(artisthash: str) -> None:
    """Rebuild an artist map entry from current store truth, or drop it if orphaned."""
    rebuilt = next((r for r in create_artists([artisthash]) if r[0].artisthash == artisthash), None)

    if rebuilt is not None:
        artist, trackhashes, albumhashes = rebuilt
        ArtistStore.artistmap[artisthash] = ArtistMapEntry(
            artist=artist, albumhashes=albumhashes, trackhashes=trackhashes
        )
    elif not _artist_still_referenced(artisthash):
        ArtistStore.artistmap.pop(artisthash, None)
    # else: still referenced only as an album artist elsewhere -> keep existing entry


def _index_file(filepath: str) -> None:
    """
    Index a single file into the DB and in-memory track store.

    This is a self-contained equivalent of ``watchdogg.add_track``'s core. We do
    NOT import watchdogg: it has a broken top-level import in this fork
    (``BaseObserverSubclassCallable`` no longer exists in watchdog) and is dead
    code that nothing else imports. The album/artist maps are reconciled
    separately by the caller from store truth.
    """
    TrackStore.remove_track_by_filepath(filepath)

    config = UserConfig()
    tags = get_tags(filepath, config)
    if tags is None or tags["bitrate"] == 0 or tags["duration"] == 0:
        raise TrackEditError("Reindexed file has no readable audio stream")

    result = TrackTable.insert_one(tags)
    extract_thumb(filepath, tags["albumhash"] + ".webp", overwrite=True)

    # Build the Track via the canonical DB-load path. get_tags() does NOT include
    # id/lastplayed/playcount/playduration/config, so Track(**tags) (as the dead
    # watchdogg.add_track does) raises a TypeError — fill those in here.
    track_dict = {
        **tags,
        "id": getattr(result, "lastrowid", 0) or 0,
        "lastplayed": 0,
        "playcount": 0,
        "playduration": 0,
    }
    TrackStore.add_track(track_to_dataclass(track_dict, config))


def _reindex_file(filepath: str) -> None:
    """Delete the old DB row (filepath is UNIQUE) then re-index the file from disk."""
    TrackTable.remove_tracks_by_filepaths({filepath})
    _index_file(filepath)


def edit_track_tags(old_trackhash: str, fields: dict) -> Track:
    """
    Edit the tags of the track identified by ``old_trackhash``.

    :param old_trackhash: The current trackhash (as known by clients/references).
    :param fields: Mapping of field name -> new value (see ``tag_writer.write_tags``).
    :returns: The reindexed :class:`Track` with its new identity.
    :raises TrackNotFoundError: If no track matches ``old_trackhash`` or the file
        is missing on disk.
    :raises TrackEditError: If writing/reindexing fails (the original file is
        restored before re-raising).
    """
    fields = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not fields:
        raise TrackEditError("No editable fields provided")

    group = TrackStore.trackhashmap.get(old_trackhash)
    if not group or len(group) == 0:
        raise TrackNotFoundError("Track not found")

    old_track = group.get_best()
    filepath = old_track.filepath
    old_albumhash = old_track.albumhash
    old_artist_hashes = _identity_artist_hashes(old_track)

    if not os.path.exists(filepath):
        raise TrackNotFoundError("Track file not found on disk")

    backup_path = filepath + ".bak"
    new_albumhash: str | None = None
    new_artist_hashes: set[str] = set()

    try:
        shutil.copy2(filepath, backup_path)
    except OSError as exc:
        raise TrackEditError(f"Could not create backup: {exc}") from exc

    try:
        tag_writer.write_tags(filepath, fields)
        _reindex_file(filepath)

        new_tracks = TrackStore.get_tracks_by_filepaths([filepath])
        if not new_tracks:
            raise TrackEditError("Track disappeared after reindex")

        new_track = new_tracks[0]
        new_trackhash = new_track.trackhash
        new_albumhash = new_track.albumhash
        new_artist_hashes = _identity_artist_hashes(new_track)

        # Reconcile the in-memory album/artist maps for both old and new identities.
        for albumhash in {old_albumhash, new_albumhash}:
            _reconcile_album(albumhash)
        for artisthash in old_artist_hashes | new_artist_hashes:
            _reconcile_artist(artisthash)

        # Repoint references only when the old identity is fully gone. If other
        # files still share the old trackhash (duplicate tracks), the old hash
        # stays valid and its references must not be moved to the edited file.
        if new_trackhash != old_trackhash and old_trackhash not in TrackStore.trackhashmap:
            migrate_track_references(old_trackhash, new_trackhash)
    except Exception as exc:
        log.error("Track edit failed for %s: %s", filepath, exc)
        # Rollback must never mask the original failure with a fresh exception.
        try:
            _rollback(filepath, backup_path, old_albumhash, old_artist_hashes, new_albumhash, new_artist_hashes)
        except Exception as rollback_exc:
            log.error("Rollback failed for %s: %s", filepath, rollback_exc)
        if isinstance(exc, TrackEditError):
            raise
        raise TrackEditError(str(exc)) from exc

    _remove_backup(backup_path)
    return new_track


def _rollback(
    filepath: str,
    backup_path: str,
    old_albumhash: str,
    old_artist_hashes: set[str],
    new_albumhash: str | None,
    new_artist_hashes: set[str],
) -> None:
    """Restore the original file and re-index it so store/DB match un-migrated references."""
    if not os.path.exists(backup_path):
        return

    try:
        shutil.copy2(backup_path, filepath)
    except OSError as exc:
        # Do NOT delete the backup here: the restore failed, so this ``.bak`` is
        # the only intact copy of the original file. Keep it and surface its path
        # so the file can be recovered manually.
        log.error(
            "CRITICAL: failed to restore backup %s -> %s: %s. Backup KEPT at %s for manual recovery.",
            backup_path,
            filepath,
            exc,
            backup_path,
        )
        return

    try:
        _reindex_file(filepath)
        for albumhash in {old_albumhash, new_albumhash} - {None}:
            _reconcile_album(albumhash)
        for artisthash in old_artist_hashes | new_artist_hashes:
            _reconcile_artist(artisthash)
    except Exception as exc:
        log.error("Failed to re-index after rollback for %s: %s", filepath, exc)

    _remove_backup(backup_path)


def _remove_backup(backup_path: str) -> None:
    try:
        if os.path.exists(backup_path):
            os.remove(backup_path)
    except OSError as exc:
        log.warning("Could not remove backup %s: %s", backup_path, exc)
