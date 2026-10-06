"""
Edit a track's metadata tags while keeping the library and references consistent.

P1 scope: text tags only (cover art is P1b). Because the trackhash is derived
from title/album/artist, editing those fields changes the track's identity. The
flow therefore is: back up the file, write the new tags, then swap the track's
row AND repoint all playlist/favorite/history references from the old hash to
the new one in ONE database transaction. Any failure up to that commit restores
the backup and nothing else, because the database never changed. Only after it
do the in-memory stores and the album/artist maps follow.

Note: ``watchdogg.remove_track`` is dead/broken in this fork (references an
undefined ``db`` symbol and removed store helpers), so removal of the old DB row
and the in-memory map cleanup are done explicitly here instead.
"""

from __future__ import annotations

import logging
import os
import shutil

from aivinnet.config import UserConfig
from aivinnet.db.libdata import TrackTable
from aivinnet.db.utils import track_to_dataclass
from aivinnet.lib import tag_writer
from aivinnet.lib.reference_migration import migrate_track_references, migrate_track_references_many
from aivinnet.lib.tagger import create_albums, create_artists
from aivinnet.lib.taglib import extract_thumb, get_tags
from aivinnet.models import Track
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistMapEntry, ArtistStore
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore

# NOTE: do not use `from aivinnet.logger import log` — that global is None until
# setup_logger() runs and the imported name never picks up the reassignment.
log = logging.getLogger(__name__)

# Fields accepted from the API. tag_writer ignores anything it doesn't recognise.
EDITABLE_FIELDS = {"title", "artists", "albumartists", "album", "track", "disc"}
# INFO: Of these, only title/album/artists feed the trackhash. `track` and
# `disc` are pure display, which is why a numbering repair can be applied
# without moving a single playlist reference.


class TrackEditError(Exception):
    """Raised when a track's tags cannot be edited."""


class TrackNotFoundError(TrackEditError):
    """Raised when the track to edit cannot be found in the store."""


class AmbiguousTrackError(TrackEditError):
    """Raised when a trackhash names several files and none was picked."""

    def __init__(self, filepaths: list[str]):
        super().__init__(f"{len(filepaths)} files share this trackhash; pass the filepath of the one to edit")
        self.filepaths = filepaths


def _identity_artist_hashes(track: Track) -> set[str]:
    """All artisthashes that identify a track: performing artists + album artists."""
    hashes = set(track.artisthashes or [])
    for artist in track.albumartists:
        hashes.add(artist["artisthash"])
    return hashes


# State the stores derive at startup from OTHER tables (favorites, scrobbles,
# colors). A rebuilt track/album/artist starts empty, so without carrying it
# over every tag edit showed the track, its album and its artists as
# un-favourited and unplayed, and dropped the artist colour — until a restart
# re-derived it. The tables themselves were never touched.
_DERIVED_STATE = ("fav_userids", "playcount", "playduration", "lastplayed", "color")


def _carry_over(old, new, names: tuple[str, ...] = _DERIVED_STATE) -> None:
    for name in names:
        if not (hasattr(old, name) and hasattr(new, name)):
            continue
        value = getattr(old, name)
        if name == "color" and not value:
            continue
        setattr(new, name, list(value) if isinstance(value, list) else value)


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

        if existing is not None:
            _carry_over(existing.album, album)

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
        existing = ArtistStore.artistmap.get(artisthash)
        if existing is not None:
            _carry_over(existing.artist, artist)
        ArtistStore.artistmap[artisthash] = ArtistMapEntry(
            artist=artist, albumhashes=albumhashes, trackhashes=trackhashes
        )
    elif not _artist_still_referenced(artisthash):
        ArtistStore.artistmap.pop(artisthash, None)
    elif (entry := ArtistStore.artistmap.get(artisthash)) is not None:
        # Only an album artist ("Various Artists"): no track names it as a
        # performer, so there is nothing to rebuild the entry from — but its
        # album list must still follow the edit. It kept the album the edit had
        # just retired and missed the new one, until a restart (#296).
        tracks = [t for t in TrackStore.get_flat_list() if any(a["artisthash"] == artisthash for a in t.albumartists)]
        entry.albumhashes = {t.albumhash for t in tracks}
        entry.trackhashes = {t.trackhash for t in tracks}


def _read_tags(filepath: str) -> dict:
    """The file's tags as the indexer reads them, or an error if it has no audio."""
    tags = get_tags(filepath, UserConfig())
    if tags is None or tags["bitrate"] == 0 or tags["duration"] == 0:
        raise TrackEditError("Reindexed file has no readable audio stream")
    return tags


def _as_track(tags: dict, row_id: int) -> Track:
    """
    The Track the store will hold for these tags.

    Built via the canonical DB-load path. get_tags() does NOT include
    id/lastplayed/playcount/playduration, so Track(**tags) (as the dead
    watchdogg.add_track does) raises a TypeError — fill those in here. The
    trackhash is derived HERE, not taken from the tags: it is the one playlists
    and favourites must point at.
    """
    track_dict = {**tags, "id": row_id, "lastplayed": 0, "playcount": 0, "playduration": 0}
    return track_to_dataclass(track_dict, UserConfig())


def _store_track(filepath: str, track: Track, carry_references: bool = True) -> None:
    """
    Put a freshly committed track into the in-memory stores, replacing the old one.

    This is a self-contained equivalent of ``watchdogg.add_track``'s core. We do
    NOT import watchdogg: it has a broken top-level import in this fork
    (``BaseObserverSubclassCallable`` no longer exists in watchdog) and is dead
    code that nothing else imports. The album/artist maps are reconciled
    separately by the caller from store truth.
    """
    previous = next(iter(TrackStore.get_tracks_by_filepaths([filepath])), None)
    TrackStore.remove_track_by_filepath(filepath)
    if previous is not None:
        # Favourites and play counts belong to the HASH they are stored under.
        # When another file keeps the old hash, the database references stay
        # there — carrying them in RAM showed the edited track as favourited
        # until the next restart, and a toggle hit a row that did not exist.
        _carry_over(previous, track, ("color",) if not carry_references else _DERIVED_STATE)
    TrackStore.add_track(track)
    # The folder view looks files up by their hash, and the hash may just have
    # changed with the tags.
    FolderStore.index_file(filepath, track.trackhash)


def edit_track_tags(old_trackhash: str, fields: dict, filepath: str | None = None) -> Track:
    """
    Edit the tags of the track identified by ``old_trackhash``.

    ⚠️ A trackhash is **not unique**: it is derived from title/album/artists, so
    ``X.mp3`` next to ``X.wav`` with the same tags share one, and so does every
    file of an album whose tags all say "Track 1". This used to edit whichever
    of them ``get_best()`` (highest bitrate) returned — live on 2026-10-02 a
    batch of one PUT per file rewrote every WAV twice and never touched an MP3,
    and each of those requests reported success. So it no longer guesses: when
    the hash names several files, ``filepath`` must say which one.

    :param old_trackhash: The current trackhash (as known by clients/references).
    :param fields: Mapping of field name -> new value (see ``tag_writer.write_tags``).
    :param filepath: The file to edit. Required when several files share the hash;
        must be one of them.
    :returns: The reindexed :class:`Track` with its new identity.
    :raises TrackNotFoundError: If no track matches ``old_trackhash`` (and
        ``filepath``) or the file is missing on disk.
    :raises AmbiguousTrackError: If several files share the hash and no
        ``filepath`` was given.
    :raises TrackEditError: If writing/reindexing fails (the original file is
        restored before re-raising).
    """
    group = TrackStore.trackhashmap.get(old_trackhash)
    if not group or len(group) == 0:
        raise TrackNotFoundError("Track not found")

    if filepath is not None:
        track = next((t for t in group.tracks if t.filepath == filepath), None)
        if track is None:
            raise TrackNotFoundError("No file with this trackhash at that path")
        return _edit(track, fields)

    if len(group) > 1:
        raise AmbiguousTrackError([t.filepath for t in group.tracks])

    return _edit(group.tracks[0], fields)


class ReferenceBatch:
    """
    The references of a multi-file apply, for renames that chain.

    ⚠️ A file whose NEW hash is the CURRENT hash of another file in the same
    batch — two titles swapped, a run of them shifted by one — must not move
    its references on its own. They would merge into the other file's, and the
    next step would carry the merged ones on: a playlist lost entries, and
    after a shift everything pointed at the last title (#296). Those pairs wait
    and move together at the end (``finish``); every other edit keeps moving its
    references in its own transaction, together with its row.
    """

    def __init__(self, filepaths: list[str]) -> None:
        # The hashes as they are BEFORE anything in the batch is written.
        self._old_hashes: dict[str, str] = {}
        for track in TrackStore.get_tracks_by_filepaths(filepaths):
            self._old_hashes[track.filepath] = track.trackhash
        self.pending: dict[str, str] = {}
        # Files that took a hash during THIS batch. They are not "another file
        # that keeps the old hash" for the file that still holds it: in a swap,
        # A lands on B's hash before B is edited (see `_edit`).
        self.arrived: dict[str, set[str]] = {}

    def must_wait(self, filepath: str, new_trackhash: str) -> bool:
        return any(h == new_trackhash for p, h in self._old_hashes.items() if p != filepath)

    def finish(self) -> None:
        """Move the waiting references, all at once. Raises if the database refuses."""
        migrate_track_references_many(self.pending)
        self.pending = {}


def edit_track_tags_by_filepath(filepath: str, fields: dict, batch: ReferenceBatch | None = None) -> Track:
    """
    Edit the tags of one specific FILE.

    The path is the only identifier of a track that survives a tag change, and
    the only one that is unique. A batch that repairs a whole album has to use
    it: addressing the rows by trackhash means several of them can name the same
    group, and then ``get_best()`` decides which file receives which title.
    A batch passes its ``ReferenceBatch`` so chained renames move together.
    """
    tracks = TrackStore.get_tracks_by_filepaths([filepath])
    if not tracks:
        raise TrackNotFoundError("Track not found")

    return _edit(tracks[0], fields, batch)


def _edit(old_track: Track, fields: dict, batch: ReferenceBatch | None = None) -> Track:
    """The edit itself, once the exact track to change has been resolved."""
    fields = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not fields:
        raise TrackEditError("No editable fields provided")

    old_trackhash = old_track.trackhash
    filepath = old_track.filepath
    old_albumhash = old_track.albumhash
    old_artist_hashes = _identity_artist_hashes(old_track)

    if not os.path.exists(filepath):
        raise TrackNotFoundError("Track file not found on disk")

    backup_path = filepath + ".bak"

    # A backup that is still there is the leftover of an edit whose restore
    # failed (or of a crash mid-write) — and then it may be the ONLY intact copy
    # of the audio. Copying the current file over it would destroy exactly that.
    if os.path.exists(backup_path):
        raise TrackEditError(
            f"A backup from an earlier failed edit is still there: {backup_path}. "
            "Check it and restore or remove it before editing this file again."
        )

    try:
        shutil.copy2(filepath, backup_path)
    except OSError as exc:
        raise TrackEditError(f"Could not create backup: {exc}") from exc

    # Phase 1: file, row and references. Everything that can fail on disk or in
    # the database happens here, and the DB part is ONE transaction — so a
    # failure (a locked database, live on 2026-09-30) leaves the old row and
    # its references untouched, and putting the original file back is all the
    # rollback has to do. It used to re-index the restored file instead, with
    # its own DB writes, and those hit the same lock: the row was deleted and
    # never re-inserted, and five tracks vanished from the library.
    try:
        tag_writer.write_tags(filepath, fields)
        tags = _read_tags(filepath)
        new_track = _as_track(tags, 0)
        new_trackhash = new_track.trackhash

        # Repoint references only when the old identity is fully gone. If other
        # files still share the old trackhash (duplicate tracks), the old hash
        # stays valid and its references must not be moved to the edited file.
        group = TrackStore.trackhashmap.get(old_trackhash)
        newcomers = batch.arrived.get(old_trackhash, set()) if batch is not None else set()
        others_keep_old_hash = group is not None and any(
            t.filepath != filepath and t.filepath not in newcomers for t in group.tracks
        )
        repoint = new_trackhash != old_trackhash and not others_keep_old_hash
        # A rename onto another batch file's current hash waits for the batch
        # (ReferenceBatch); everything else moves with its row, right here.
        wait = repoint and batch is not None and batch.must_wait(filepath, new_trackhash)

        new_track.id = TrackTable.replace_by_filepath(
            tags,
            also=(
                (lambda session: migrate_track_references(old_trackhash, new_trackhash, session))
                if repoint and not wait
                else None
            ),
        )
    except Exception as exc:
        log.error("Track edit failed for %s: %s", filepath, exc)
        # Rollback must never mask the original failure with a fresh exception.
        try:
            _restore_backup(filepath, backup_path)
        except Exception as rollback_exc:
            log.error("Rollback failed for %s: %s", filepath, rollback_exc)
        if isinstance(exc, TrackEditError):
            raise
        raise TrackEditError(str(exc)) from exc

    # Phase 2: the edit is committed — file, row and references agree (or, in
    # a batch, the references wait for `ReferenceBatch.finish`). Only the
    # in-memory views follow now, and putting the old file back from here
    # would make it disagree with its own row.
    _remove_backup(backup_path)
    if batch is not None:
        if wait:
            batch.pending[old_trackhash] = new_trackhash
        if new_trackhash != old_trackhash:
            batch.arrived.setdefault(new_trackhash, set()).add(filepath)

    # Not overwritten: a tag edit does not change the picture in the file. With
    # overwrite every edit put the file's (often small) embedded art back over
    # a cover the user had chosen (#296). A NEW album hash has no thumbnail yet
    # and still gets one.
    try:
        extract_thumb(filepath, tags["albumhash"] + ".webp", overwrite=False)
    except Exception as exc:
        log.warning("Track edit of %s: could not refresh the thumbnail: %s", filepath, exc)

    # The edit succeeded and is reported as such even if a view fails to
    # follow: the stores are a cache of the database, and the next scan
    # rebuilds them. Reporting a failure here would make the user redo an
    # edit that is already on disk.
    try:
        _store_track(filepath, new_track, carry_references=new_trackhash == old_trackhash or repoint)
        # Reconcile the in-memory album/artist maps for both old and new identities.
        for albumhash in {old_albumhash, new_track.albumhash}:
            _reconcile_album(albumhash)
        for artisthash in old_artist_hashes | _identity_artist_hashes(new_track):
            _reconcile_artist(artisthash)
    except Exception:
        log.exception("Track edit of %s is saved, but the library view is stale until the next scan", filepath)

    return new_track


def _restore_backup(filepath: str, backup_path: str) -> None:
    """
    Put the original file back. The database was never changed, so nothing else
    has to be undone — and nothing that needs the database can fail here.
    """
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

    _remove_backup(backup_path)


def _remove_backup(backup_path: str) -> None:
    try:
        if os.path.exists(backup_path):
            os.remove(backup_path)
    except OSError as exc:
        log.warning("Could not remove backup %s: %s", backup_path, exc)
