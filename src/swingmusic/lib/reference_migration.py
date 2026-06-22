"""
Repoint trackhash references when a track's identity changes after a tag edit.

A trackhash is derived from title/album/artist metadata, so editing those tags
yields a *new* trackhash. Playlists, favorites and play history all store the
old trackhash and must be migrated to the new one across **all users** — the
standard table helpers in ``db.userdata`` are scoped to the current user and
therefore cannot be reused here.

The list-replacement and favorites-collision decision are kept as pure functions
(no heavy imports) so they can be unit-tested without a database. The actual DB
work in ``migrate_track_references`` imports its dependencies lazily.
"""

from __future__ import annotations

from collections.abc import Sequence


def replace_trackhash_in_list(trackhashes: Sequence[str], old: str, new: str) -> list[str]:
    """
    Return ``trackhashes`` with ``old`` replaced by ``new``, preserving order.

    If ``new`` is already present, the entries collapse to a single ``new`` at
    the earliest position so the list never gains a duplicate. If ``old`` is not
    present, the list is returned unchanged (as a copy).
    """
    if old not in trackhashes:
        return list(trackhashes)

    result: list[str] = []
    new_added = False

    for h in trackhashes:
        if h in (old, new):
            if not new_added:
                result.append(new)
                new_added = True
            continue
        result.append(h)

    return result


def favorite_migration_action(new_exists: bool) -> str:
    """
    Decide how to migrate a favorite row given the global ``UNIQUE(hash)`` constraint.

    Returns ``"drop"`` when the new trackhash is already favorited (renaming the
    old row would violate the unique constraint, so the stale old row is deleted)
    and ``"rename"`` otherwise.
    """
    return "drop" if new_exists else "rename"


def migrate_track_references(old_trackhash: str, new_trackhash: str) -> None:
    """
    Repoint every reference from ``old_trackhash`` to ``new_trackhash``.

    Covers playlists, favorites and the scrobble/play-history table for ALL users,
    in a single transaction so the update is atomic.
    """
    if not old_trackhash or not new_trackhash or old_trackhash == new_trackhash:
        return

    from sqlalchemy import delete, select, update

    from swingmusic.db.engine import DbEngine
    from swingmusic.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    old_fav = f"track_{old_trackhash}"
    new_fav = f"track_{new_trackhash}"

    with DbEngine.manager(commit=True) as session:
        # Playlists (all users): in-place, order-preserving replacement.
        rows = session.execute(select(PlaylistTable.id, PlaylistTable.trackhashes)).all()
        for playlist_id, trackhashes in rows:
            if not trackhashes or old_trackhash not in trackhashes:
                continue

            session.execute(
                update(PlaylistTable)
                .where(PlaylistTable.id == playlist_id)
                .values(trackhashes=replace_trackhash_in_list(trackhashes, old_trackhash, new_trackhash))
            )

        # Favorites: `hash` has a global UNIQUE constraint. Avoid a collision if
        # the new track is already favorited by dropping the stale old row.
        new_exists = session.execute(select(FavoritesTable.id).where(FavoritesTable.hash == new_fav)).first() is not None

        if favorite_migration_action(new_exists) == "drop":
            session.execute(delete(FavoritesTable).where(FavoritesTable.hash == old_fav))
        else:
            session.execute(update(FavoritesTable).where(FavoritesTable.hash == old_fav).values(hash=new_fav))

        # Play history / scrobbles (all users): plain indexed trackhash column.
        session.execute(
            update(ScrobbleTable).where(ScrobbleTable.trackhash == old_trackhash).values(trackhash=new_trackhash)
        )
