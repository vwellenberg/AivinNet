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
from typing import Any

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


def migrate_added_at(added_at: dict[str, int] | None, old: str, new: str) -> dict[str, int]:
    """
    Move the ``added_at`` entry of ``old`` onto ``new``, dropping the old key.

    ``added_at`` is a parallel map keyed by trackhash, so it has to follow every
    trackhash rewrite or it silently rots: the migrated track shows "—" as its
    date added (its entry is now keyed by a hash nobody stores) and the stale key
    lingers forever. Fixing a typo in a title must not reset how long the track
    has been in the playlist.

    When BOTH identities carry a date — the playlist held the new hash already,
    and ``replace_trackhash_in_list`` collapses them to one entry — the EARLIER
    timestamp wins: that is when the track first entered the playlist.
    """
    result = dict(added_at or {})

    if old not in result:
        return result

    old_ts = result.pop(old)
    existing = result.get(new)
    result[new] = min(old_ts, existing) if existing is not None else old_ts

    return result


def playlist_migration_values(
    trackhashes: Sequence[str] | None,
    extra: dict[str, Any] | None,
    old: str,
    new: str,
) -> dict[str, Any] | None:
    """
    The column values needed to migrate ONE playlist, or None when it is not
    affected.

    Pulled out of the DB loop so the decision — which columns change, and that
    ``extra["added_at"]`` changes *with* ``trackhashes`` — is testable without a
    database. The original bug was exactly here: the list was rewritten and the
    parallel map was forgotten, which no test of the list helper alone can catch.
    """
    if not trackhashes or old not in trackhashes:
        return None

    values: dict[str, Any] = {"trackhashes": replace_trackhash_in_list(trackhashes, old, new)}

    added_at = (extra or {}).get("added_at")
    if added_at:
        migrated = migrate_added_at(added_at, old, new)
        if migrated != added_at:
            values["extra"] = {**(extra or {}), "added_at": migrated}

    return values


def favorite_migration_action(old_userid: int | None, new_userid: int | None) -> str:
    """
    Decide how to migrate the favorite of a single track identity for ONE user.

    ``FavoritesTable`` is unique per ``(hash, userid)``, so the decision is made
    per owner: renaming user A's row can never collide with user B's row for the
    same hash.

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
        - ``"keep"``   – the two rows belong to DIFFERENT users. The caller below
          never asks that question anymore (it groups by user first), but the
          branch stays: it is the answer that must never turn into a delete, and
          keeping it here means an unscoped caller cannot destroy another user's
          favorite by accident. Under the old GLOBAL ``UNIQUE(hash)`` this was a
          real outcome and left the old favorite dangling.
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
        # Playlists (all users): in-place, order-preserving replacement. The
        # `added_at` map in `extra` is keyed by trackhash, so it has to be
        # rewritten in the same statement or the track loses its "date added".
        rows = session.execute(select(PlaylistTable.id, PlaylistTable.trackhashes, PlaylistTable.extra)).all()
        for playlist_id, trackhashes, extra in rows:
            values = playlist_migration_values(trackhashes, extra, old_trackhash, new_trackhash)

            if values is None:
                continue

            session.execute(update(PlaylistTable).where(PlaylistTable.id == playlist_id).values(values))

        # Favorites: one row per user per hash, so the same track can be
        # favorited by several people and each row has to be decided on its own.
        # A single blanket UPDATE would hit the (hash, userid) constraint for
        # every user who had already favorited the new identity.
        old_owners = {
            row.userid
            for row in session.execute(
                select(FavoritesTable.userid).where(FavoritesTable.hash == old_fav)
            ).all()
        }
        new_owners = {
            row.userid
            for row in session.execute(
                select(FavoritesTable.userid).where(FavoritesTable.hash == new_fav)
            ).all()
        }

        for userid in old_owners:
            action = favorite_migration_action(userid, userid if userid in new_owners else None)

            if action == "rename":
                session.execute(
                    update(FavoritesTable)
                    .where(FavoritesTable.hash == old_fav, FavoritesTable.userid == userid)
                    .values(hash=new_fav)
                )
            elif action == "drop":
                # This user already favorited the new identity, so their old row
                # is redundant — and renaming it would collide with their own.
                session.execute(
                    delete(FavoritesTable).where(
                        FavoritesTable.hash == old_fav, FavoritesTable.userid == userid
                    )
                )

        if old_owners:
            log.info(
                "Track edit %s -> %s: carried the favorite across for %s user(s)",
                old_trackhash,
                new_trackhash,
                len(old_owners),
            )

        # Play history / scrobbles (all users): plain indexed trackhash column.
        session.execute(
            update(ScrobbleTable).where(ScrobbleTable.trackhash == old_trackhash).values(trackhash=new_trackhash)
        )
