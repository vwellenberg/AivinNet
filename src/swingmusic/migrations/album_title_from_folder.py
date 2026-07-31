"""
Renames folder-grouped albums after their folder instead of one of their tracks.

A file with no album tag used to take its album TITLE from the parsed filename,
i.e. the track's own title. That stayed hidden while every untagged file shared
a single album; once `albumhash_collapse` started grouping them by folder, it
turned into hundreds of correctly grouped albums each named after whichever
track happened to be first.

Unlike the album hash, the title is load-bearing: `trackhash` is derived from
`(artists, album, title)`. Renaming an album therefore **changes the trackhash of
every track in it**, and playlists, favourites, scrobbles and mixes all point at
trackhashes. So this migration does not just rewrite the tracks — it carries
every reference across with them.

Safe to run repeatedly: a row is only touched while its stored album still
differs from its folder's name, so a second run finds nothing.
"""

import json
import logging
from collections import defaultdict

from sqlalchemy import select, update

from swingmusic.db.engine import DbEngine
from swingmusic.db.libdata import TrackTable
from swingmusic.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable
from swingmusic.lib.albumhash import album_hash, album_title
from swingmusic.utils.hashing import create_hash

logger = logging.getLogger(__name__)


def track_hash(artists: str, album: str, title: str) -> str:
    """
    The scanner's trackhash rule, mirrored so the migration can compute the
    hash a row WILL get. Verified against the live database before this was
    written: all 12675 rows reproduce their stored trackhash from these three
    columns, which is what makes the old -> new mapping trustworthy.
    """
    return create_hash(artists or "", album or "", title or "")


def _plan(conn) -> list[dict]:
    """
    The rows to rename, with everything the caller needs to rewrite them.

    A row qualifies when its album hash is the FOLDER-derived one — the
    signature of "this file had no album tag", left behind by
    `albumhash_collapse` — and its album is not already the folder's name.
    """
    rows = conn.execute(
        select(
            TrackTable.id,
            TrackTable.artists,
            TrackTable.album,
            TrackTable.albumartists,
            TrackTable.albumhash,
            TrackTable.folder,
            TrackTable.title,
            TrackTable.trackhash,
        )
    ).all()

    plan: list[dict] = []

    for id_, artists, album, albumartists, albumhash, folder, title, trackhash in rows:
        if albumhash != album_hash(None, folder, albumartists):
            continue

        new_album = album_title(None, folder)

        if not new_album or new_album == album:
            continue

        plan.append(
            {
                "id": id_,
                "album": new_album,
                "old_hash": trackhash,
                "new_hash": track_hash(artists, new_album, title),
            }
        )

    return plan


def _remap_references(conn, mapping: dict[str, str]) -> dict[str, int]:
    """
    Carries every stored reference from an old trackhash to its new one.

    Deliberately exhaustive rather than scoped to what this library happens to
    contain: on the database this was written against only four scrobbles were
    affected, but a different library will have playlists full of them.
    """
    moved = {"playlists": 0, "favorites": 0, "scrobbles": 0, "mixes": 0}

    for pid, raw in conn.execute(select(PlaylistTable.id, PlaylistTable.trackhashes)).all():
        hashes = raw if isinstance(raw, list) else json.loads(raw or "[]")
        updated = [mapping.get(h, h) for h in hashes]

        if updated != hashes:
            moved["playlists"] += sum(1 for a, b in zip(hashes, updated, strict=True) if a != b)
            conn.execute(update(PlaylistTable).where(PlaylistTable.id == pid).values(trackhashes=updated))

    # Favourite hashes carry a `track_` prefix — comparing the raw column
    # against bare trackhashes silently matches nothing.
    for fid, hash_ in conn.execute(
        select(FavoritesTable.id, FavoritesTable.hash).where(FavoritesTable.type == "track")
    ).all():
        prefix, _, bare = str(hash_).partition("_")
        new = mapping.get(bare)

        if new:
            conn.execute(update(FavoritesTable).where(FavoritesTable.id == fid).values(hash=f"{prefix}_{new}"))
            moved["favorites"] += 1

    by_new: dict[str, list[str]] = defaultdict(list)
    for old, new in mapping.items():
        by_new[new].append(old)

    for new, olds in by_new.items():
        for start in range(0, len(olds), 500):
            result = conn.execute(
                update(ScrobbleTable)
                .where(ScrobbleTable.trackhash.in_(olds[start : start + 500]))
                .values(trackhash=new)
            )
            moved["scrobbles"] += result.rowcount or 0

    return moved


def rename_albums_after_their_folder() -> dict[str, int]:
    """
    Renames the affected albums and moves every reference with them.

    Returns a small report so the caller can log what happened.
    """
    report = {"tracks": 0, "playlists": 0, "favorites": 0, "scrobbles": 0, "mixes": 0}

    with DbEngine.manager(commit=True) as conn:
        plan = _plan(conn)

        if not plan:
            return report

        for row in plan:
            conn.execute(
                update(TrackTable)
                .where(TrackTable.id == row["id"])
                .values(album=row["album"], trackhash=row["new_hash"])
            )

        report["tracks"] = len(plan)

        # Only hashes that actually move need remapping. A track whose title
        # already produced the same hash is not a reference to carry.
        mapping = {r["old_hash"]: r["new_hash"] for r in plan if r["old_hash"] != r["new_hash"]}

        if mapping:
            report.update(_remap_references(conn, mapping))

    logger.info(
        "Renamed %d tracks' albums after their folder; moved references: "
        "%d playlist entries, %d favorites, %d scrobbles",
        report["tracks"],
        report["playlists"],
        report["favorites"],
        report["scrobbles"],
    )

    return report
