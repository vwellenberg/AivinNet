"""
Carry references over to the names the server cleans when it loads the library.

The server takes a track number off the front of a title ("049 Saint Wenceslaus
Theme") and a role off the front of an artist ("Composed by Adam Sporka") —
`utils/parsers.py::strip_track_number` and `strip_artist_credit`, applied in
`models/track.py`. The files keep their tags. But a trackhash is made of title,
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


def legacy_track_mapping(tracks: Iterable[Any]) -> dict[str, str]:
    """
    old trackhash -> new, for the tracks the cleanup renamed.

    The same rules as a rescan (`rescan_remap.remap_by_path`): an old hash that
    another track still carries keeps its references, and one that split into
    two new hashes cannot follow both.
    """
    before: dict[str, str] = {}
    after: dict[str, str] = {}

    for track in tracks:
        before[track.filepath] = track._legacyhash or track.trackhash
        after[track.filepath] = track.trackhash

    return remap_by_path(before, after)


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


def _collections_with_artists(session: Any, mapping: dict[str, str]) -> list[tuple[int, list[dict[str, Any]]]]:
    """(id, items rewritten) of every homepage collection that holds a renamed artist."""
    from sqlalchemy import select

    from aivinnet.db.userdata import CollectionTable

    out: list[tuple[int, list[dict[str, Any]]]] = []

    for collection_id, items in session.execute(select(CollectionTable.id, CollectionTable.items)).all():
        items = items or []
        rewritten = [
            {**item, "hash": mapping[item["hash"]]}
            if isinstance(item, dict) and item.get("type") == "artist" and item.get("hash") in mapping
            else item
            for item in items
        ]
        if rewritten != items:
            out.append((collection_id, rewritten))

    return out


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

        for folder in folders:
            source, target = folder / f"{old}.webp", folder / f"{new}.webp"
            if source.exists() and not target.exists():
                try:
                    shutil.copy2(source, target)
                    copied += 1
                except OSError as error:
                    log.warning("Could not copy the picture of artist %s to %s: %s", old, new, error)

        if (marker_dir / old).exists() and not (marker_dir / new).exists():
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

    if not track_map and not artist_map:
        return

    if artist_map:
        report["artist_images"] = _copy_artist_images(artist_map)

    from aivinnet.db.engine import DbEngine
    from aivinnet.lib.reference_migration import migrate_item_favorites, migrate_track_references_many

    # Read first, write only what is referenced: on every start after the first
    # this finds nothing, and a start should not open a write for nothing.
    with DbEngine.manager() as session:
        referenced = _referenced_trackhashes(session, set(track_map)) if track_map else set()
        favorited = _favorited_artisthashes(session, set(artist_map)) if artist_map else set()
        collections = _collections_with_artists(session, artist_map) if artist_map else []

    track_map = {old: new for old, new in track_map.items() if old in referenced}
    favorite_map = {old: new for old, new in artist_map.items() if old in favorited}

    if track_map or favorite_map or collections:
        from sqlalchemy import update

        from aivinnet.db.userdata import CollectionTable

        with DbEngine.manager(commit=True) as session:
            if track_map:
                migrate_track_references_many(track_map, session=session)
            for old, new in favorite_map.items():
                migrate_item_favorites("artist", old, new, session)
            for collection_id, items in collections:
                session.execute(update(CollectionTable).where(CollectionTable.id == collection_id).values(items=items))

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
