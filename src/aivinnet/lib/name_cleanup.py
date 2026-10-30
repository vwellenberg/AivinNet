"""
Carry references over to the names the server cleans when it loads the library.

The server takes a track number off the front of a title ("049 Saint Wenceslaus
Theme") and a role off the front of an artist ("Composed by Adam Sporka"), and
reads UTF-8 that a tagger had read as Windows-1252 again ("Whereâ€™s" ->
"Where\u2019s") — `utils/parsers.py::strip_track_number`, `strip_artist_credit` and
`repair_mojibake`, applied in `models/track.py`. The files keep their tags. But a trackhash is made of title,
album and artists, and an artisthash of the name, so both change: favourites,
playlists, scrobbles and homepage collections still hold the old hashes and
would point at nothing.

Each track remembers what it was called before (`Track._legacyhash`,
`Track._legacy_artisthashes`). After every load this module moves what still
points at an old hash. Once moved, nothing refers to the old hashes any more,
so the next start finds nothing to do and writes nothing.

The mapping is pure (`legacy_track_mapping`, `legacy_artist_mapping`) so the
fast test lane can run it; the database work imports its dependencies lazily.
"""

from __future__ import annotations

import json
import logging
import shutil
from collections.abc import Iterable
from typing import Any

from aivinnet.lib.rescan_remap import remap_by_path

log = logging.getLogger(__name__)

# SQLite caps the parameters of one statement; stay well below every build's cap.
_CHUNK = 500

# old trackhash -> the one the library uses now, for every track the cleanup
# renamed. Browsers keep their queues with the hashes the tracks had when they
# were queued; a stream or a scrobble from such a queue asks for the old one.
# Set whole on every load, never edited in place.
_current: dict[str, str] = {}


def current_trackhash(trackhash: str) -> str:
    """The hash the library uses now for `trackhash`, or `trackhash` itself."""
    return _current.get(trackhash, trackhash)


def legacy_track_mapping(tracks: Iterable[Any]) -> dict[str, str]:
    """
    old trackhash -> new, for the tracks the cleanup renamed.

    The same rules as a rescan (`rescan_remap.remap_by_path`): an old hash that
    another track still carries keeps its references, and one that split into
    two new hashes cannot follow both.

    A track can have had several old hashes — under its raw tags and under the
    cleanups of the releases before (`Track._previoushashes`, one place per
    release, "" where it adds nothing) — depending on which release the library
    last ran. Each release is mapped by the same rules, and an old hash two of
    them send to different tracks follows neither.
    """
    tracks = list(tracks)
    after = {track.filepath: track.trackhash for track in tracks}
    olds = {track.filepath: (track._legacyhash, *track._previoushashes) for track in tracks}
    targets: dict[str, set[str]] = {}

    for slot in range(max(map(len, olds.values()), default=0)):
        before = {path: (old[slot] if slot < len(old) else "") or after[path] for path, old in olds.items()}
        for old, new in remap_by_path(before, after).items():
            targets.setdefault(old, set()).add(new)

    return {old: next(iter(news)) for old, news in targets.items() if len(news) == 1}


def legacy_artist_mapping(tracks: Iterable[Any]) -> dict[str, str]:
    """old artisthash -> new, for the artist names the cleanup changed."""
    tracks = list(tracks)
    present = {a["artisthash"] for t in tracks for a in (*t.artists, *t.albumartists)}
    targets: dict[str, set[str]] = {}

    for track in tracks:
        for old, new in track._legacy_artisthashes:
            if old not in present:
                targets.setdefault(old, set()).add(new)

    return {old: next(iter(news)) for old, news in targets.items() if len(news) == 1}


def _chunks(items: list[str]) -> Iterable[list[str]]:
    for start in range(0, len(items), _CHUNK):
        yield items[start : start + _CHUNK]


def _referenced_trackhashes(session: Any, hashes: set[str]) -> set[str]:
    """Which of `hashes` a playlist, a favourite or a scrobble still holds."""
    from sqlalchemy import select

    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    found: set[str] = set()

    for (raw,) in session.execute(select(PlaylistTable.trackhashes)).all():
        trackhashes = raw if isinstance(raw, list) else json.loads(raw or "[]")
        found.update(hashes.intersection(trackhashes))

    wanted = sorted(hashes - found)
    for chunk in _chunks(wanted):
        keys = [f"track_{h}" for h in chunk]
        rows = session.execute(select(FavoritesTable.hash).where(FavoritesTable.hash.in_(keys))).all()
        found.update(str(h).partition("_")[2] for (h,) in rows)

    wanted = sorted(hashes - found)
    for chunk in _chunks(wanted):
        rows = session.execute(
            select(ScrobbleTable.trackhash).where(ScrobbleTable.trackhash.in_(chunk)).distinct()
        ).all()
        found.update(h for (h,) in rows)

    return found


def _favorited_artisthashes(session: Any, hashes: set[str]) -> set[str]:
    from sqlalchemy import select

    from aivinnet.db.userdata import FavoritesTable

    found: set[str] = set()

    for chunk in _chunks(sorted(hashes)):
        keys = [*chunk, *(f"artist_{h}" for h in chunk)]
        rows = session.execute(
            select(FavoritesTable.hash).where(FavoritesTable.type == "artist", FavoritesTable.hash.in_(keys))
        ).all()
        found.update(str(h).removeprefix("artist_") for (h,) in rows)

    return found


def _marked_artisthashes(session: Any, hashes: set[str]) -> set[str]:
    """The old artist hashes a "Not interested" mark (#531) still names."""
    from sqlalchemy import select

    from aivinnet.db.userdata import NotInterestedTable

    found: set[str] = set()

    for chunk in _chunks(sorted(hashes)):
        rows = session.execute(
            select(NotInterestedTable.hash).where(
                NotInterestedTable.type == "artist", NotInterestedTable.hash.in_(chunk)
            )
        ).all()
        found.update(h for (h,) in rows)

    return found


def _copy_artist_images(mapping: dict[str, str]) -> int:
    """
    Give each renamed artist the picture of its old name, where it has none.

    Copied, not moved: the old file harms nobody, and a copy cannot lose a
    picture if this is interrupted. A hand-set choice ("user-set" marker, see
    `lib/artist_image.py`) travels with it, so the online lookup leaves it be.
    """
    from aivinnet.lib.artist_image import user_set_dir
    from aivinnet.settings import Paths

    paths = Paths()
    folders = [paths.lg_artist_img_path, paths.md_artist_img_path, paths.sm_artist_img_path]
    marker_dir = user_set_dir()
    copied = 0

    for old, new in mapping.items():
        # The owner already decided about the NEW name (removed its picture, or
        # set one): the old picture must not come back over that decision on
        # the next start.
        if (marker_dir / new).exists():
            continue

        complete = True
        for folder in folders:
            source, target = folder / f"{old}.webp", folder / f"{new}.webp"
            if source.exists() and not target.exists():
                try:
                    shutil.copy2(source, target)
                    copied += 1
                except OSError as error:
                    complete = False
                    log.warning("Could not copy the picture of artist %s to %s: %s", old, new, error)

        # The marker only once every size is there: it makes later starts skip
        # this artist, and a size that failed now must be tried again then.
        if complete and (marker_dir / old).exists():
            try:
                (marker_dir / new).touch()
            except OSError:
                pass

    return copied


def carry_cleaned_names(tracks: Iterable[Any] | None = None) -> dict[str, int]:
    """
    Move every reference that still points at a name from before the cleanup.

    Call after `TrackStore.load_all_tracks` and before the favourites and plays
    are mapped onto the stores. Returns a small report for the log. Never
    raises: a start must not fail over references it could carry next time.
    """
    report = {"tracks": 0, "artists": 0, "collections": 0, "artist_images": 0}

    try:
        _carry(tracks, report)
    except Exception:
        log.exception("Could not carry references over to the cleaned names; will retry on the next start")

    return report


def _carry(tracks: Iterable[Any] | None, report: dict[str, int]) -> None:
    if tracks is None:
        from aivinnet.store.tracks import TrackStore

        tracks = TrackStore.get_flat_list()

    tracks = list(tracks)
    track_map = legacy_track_mapping(tracks)
    artist_map = legacy_artist_mapping(tracks)

    global _current
    _current = dict(track_map)

    if not track_map and not artist_map:
        return

    if artist_map:
        report["artist_images"] = _copy_artist_images(artist_map)

    from aivinnet.db.engine import DbEngine
    from aivinnet.lib.reference_migration import (
        collections_to_move,
        migrate_identity_references,
        migrate_track_references_many,
    )

    # Read first, write only what is referenced: on every start after the first
    # this finds nothing, and a start should not open a write for nothing.
    with DbEngine.manager() as session:
        referenced = _referenced_trackhashes(session, set(track_map)) if track_map else set()
        favorited = _favorited_artisthashes(session, set(artist_map)) if artist_map else set()
        marked = _marked_artisthashes(session, set(artist_map)) if artist_map else set()
        collections = collections_to_move("artist", artist_map, session)

    track_map = {old: new for old, new in track_map.items() if old in referenced}
    favorite_map = {old: new for old, new in artist_map.items() if old in favorited}
    marked_map = {old: new for old, new in artist_map.items() if old in marked}

    if track_map or favorite_map or marked_map or collections:
        with DbEngine.manager(commit=True) as session:
            if track_map:
                migrate_track_references_many(track_map, session=session)
            # The same function as the tag edit, so a store added there moves
            # here too; it writes only rows that exist. ⚠️ Its probe above
            # does not come along: a store added there needs one here, or
            # it moves only when a favourite or a collection happens to.
            if favorite_map or marked_map or collections:
                migrate_identity_references("artist", artist_map, session)

    report["tracks"] = len(track_map)
    report["artists"] = len(favorite_map)
    report["collections"] = len(collections)

    if any(report.values()):
        log.info(
            "Cleaned names: moved the references of %d track(s) and %d artist(s), "
            "%d collection(s), copied %d artist picture(s)",
            report["tracks"],
            report["artists"],
            report["collections"],
            report["artist_images"],
        )
