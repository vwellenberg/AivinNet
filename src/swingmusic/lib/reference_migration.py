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

import logging
from collections.abc import Sequence

log = logging.getLogger(__name__)


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


def favorite_migration_action(old_userid: int | None, new_userid: int | None) -> str:
    """
    Decide how to migrate the favorite of a single track identity, given the
    global ``UNIQUE(hash)`` constraint on ``FavoritesTable`` (each row still has
    its own ``userid``).

    :param old_userid: Owner of the favorite on the OLD hash, or ``None`` if the
        old identity is not favorited.
    :param new_userid: Owner of an existing favorite on the NEW hash, or ``None``
        if the new identity is not favorited yet.
    :returns:
        - ``"noop"``   – the old identity is not favorited; nothing to do.
        - ``"rename"`` – no favorite on the new hash; repoint the old row to it.
        - ``"drop"``   – the SAME user already favorited the new identity, so the
          old row is redundant and is removed (renaming would hit the unique
          constraint).
        - ``"keep"``   – a DIFFERENT user already owns the new hash. The global
          unique constraint forbids a second row, so the old favorite is kept
          intact (left dangling) rather than silently deleting another user's
          data. Proper long-term fix: ``UNIQUE(userid, hash)``.
    """
    if old_userid is None:
        return "noop"
    if new_userid is None:
        return "rename"
    if new_userid == old_userid:
        return "drop"
    return "keep"


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

        # Favorites: `hash` carries a GLOBAL unique constraint, yet each row has
        # its own `userid`. Decide per-owner so we never delete a DIFFERENT user's
        # favorite when the new identity is already favorited (see
        # favorite_migration_action).
        old_row = session.execute(
            select(FavoritesTable.id, FavoritesTable.userid).where(FavoritesTable.hash == old_fav)
        ).first()
        new_row = session.execute(
            select(FavoritesTable.id, FavoritesTable.userid).where(FavoritesTable.hash == new_fav)
        ).first()

        action = favorite_migration_action(
            old_row.userid if old_row else None,
            new_row.userid if new_row else None,
        )
        if action == "rename":
            session.execute(update(FavoritesTable).where(FavoritesTable.hash == old_fav).values(hash=new_fav))
        elif action == "drop":
            session.execute(delete(FavoritesTable).where(FavoritesTable.hash == old_fav))
        elif action == "keep":
            log.warning(
                "Track edit %s -> %s: favorite for the old hash (user %s) not migrated because the "
                "new hash is already favorited by a different user (user %s) and FavoritesTable.hash "
                "is globally unique. Old favorite kept intact to avoid deleting another user's data.",
                old_trackhash,
                new_trackhash,
                old_row.userid,
                new_row.userid,
            )
        # "noop": the old identity was not favorited; nothing to do.

        # Play history / scrobbles (all users): plain indexed trackhash column.
        session.execute(
            update(ScrobbleTable).where(ScrobbleTable.trackhash == old_trackhash).values(trackhash=new_trackhash)
        )
