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


def remap_trackhash_list(trackhashes: Sequence[str], mapping: dict[str, str]) -> list[str]:
    """
    Apply a whole batch of renames to a list AT ONCE, preserving order.

    ⚠️ Not the same as calling ``replace_trackhash_in_list`` once per pair. A
    batch that swaps two titles (A->B, B->A) or shifts a run of them by one
    (1->2, 2->3, ...) maps a hash onto another one that is itself still being
    renamed. Pair by pair, the first step merged two different songs into one
    entry and every later step carried the merged entry on: a playlist lost
    entries, and after a shift everything pointed at the last title (#296).

    Entries that land on a renamed-to hash more than once collapse to the first
    (as the single-pair helper does for old+new); everything else, including
    an intentional duplicate of an unrelated track, is left alone.
    """
    targets = set(mapping.values())
    seen: set[str] = set()
    result: list[str] = []

    for h in trackhashes:
        mapped = mapping.get(h, h)
        if mapped in targets:
            if mapped in seen:
                continue
            seen.add(mapped)
        result.append(mapped)

    return result


def remap_added_at(added_at: dict[str, int] | None, mapping: dict[str, str]) -> dict[str, int]:
    """``migrate_added_at`` for a whole batch at once; on a collision the EARLIER date wins."""
    result: dict[str, int] = {}

    for h, ts in (added_at or {}).items():
        mapped = mapping.get(h, h)
        result[mapped] = min(ts, result[mapped]) if mapped in result else ts

    return result


def playlist_remap_values(
    trackhashes: Sequence[str] | None, extra: dict[str, Any] | None, mapping: dict[str, str]
) -> dict[str, Any] | None:
    """``playlist_migration_values`` for a whole batch: the changed columns, or None."""
    if not trackhashes or not any(h in mapping for h in trackhashes):
        return None

    values: dict[str, Any] = {"trackhashes": remap_trackhash_list(trackhashes, mapping)}

    added_at = (extra or {}).get("added_at")
    if added_at:
        remapped = remap_added_at(added_at, mapping)
        if remapped != added_at:
            values["extra"] = {**(extra or {}), "added_at": remapped}

    return values


def migrate_track_references_many(mapping: dict[str, str], session: Any = None) -> None:
    """
    Repoint every reference for a whole batch of renames, simultaneously.

    What a batch apply needs when its renames chain (see
    ``remap_trackhash_list``). Playlists, favorites and scrobbles of all users,
    in one transaction.
    """
    mapping = {old: new for old, new in mapping.items() if old and new and old != new}
    if not mapping:
        return

    if session is not None:
        _migrate_many(session, mapping)
        return

    from aivinnet.db.engine import DbEngine

    with DbEngine.manager(commit=True) as own_session:
        _migrate_many(own_session, mapping)


def _migrate_many(session: Any, mapping: dict[str, str]) -> None:
    from sqlalchemy import case, delete, select, update

    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    rows = session.execute(select(PlaylistTable.id, PlaylistTable.trackhashes, PlaylistTable.extra)).all()
    for playlist_id, trackhashes, extra in rows:
        values = playlist_remap_values(trackhashes, extra, mapping)
        if values is not None:
            session.execute(update(PlaylistTable).where(PlaylistTable.id == playlist_id).values(values))

    # Favorites are unique per (hash, userid), and a swap renames A onto B while
    # B still exists: every involved row moves to a placeholder of its own
    # first, then onto its target — dropped only where that user already has the
    # target (two old hashes landing on one new one).
    fav_mapping = {f"track_{old}": f"track_{new}" for old, new in mapping.items()}
    moving = session.execute(
        select(FavoritesTable.id, FavoritesTable.hash, FavoritesTable.userid).where(
            FavoritesTable.hash.in_(list(fav_mapping))
        )
    ).all()

    for row_id, _hash, _userid in moving:
        session.execute(update(FavoritesTable).where(FavoritesTable.id == row_id).values(hash=f"moving_{row_id}"))

    for row_id, old_hash, userid in moving:
        target = fav_mapping[old_hash]
        taken = session.execute(
            select(FavoritesTable.id).where(FavoritesTable.hash == target, FavoritesTable.userid == userid)
        ).first()
        if taken:
            session.execute(delete(FavoritesTable).where(FavoritesTable.id == row_id))
        else:
            session.execute(update(FavoritesTable).where(FavoritesTable.id == row_id).values(hash=target))

    # Scrobbles: no constraint, so one CASE moves them all at once.
    session.execute(
        update(ScrobbleTable)
        .where(ScrobbleTable.trackhash.in_(list(mapping)))
        .values(trackhash=case(mapping, value=ScrobbleTable.trackhash))
    )

    log.info("Batch edit: moved the references of %s renamed track(s) at once", len(mapping))


def migrate_item_favorites(kind: str, old_hash: str, new_hash: str, session: Any) -> None:
    """
    Move every user's favourite of an album or artist from ``old_hash`` to ``new_hash``.

    Per user, like tracks: a user who already favourited the new identity keeps
    that one and the old row goes. Rows from before the ``<type>_`` prefix are
    moved too.
    """
    from sqlalchemy import delete, select, update

    from aivinnet.db.userdata import FavoritesTable

    new_key = f"{kind}_{new_hash}"
    rows = session.execute(
        select(FavoritesTable.id, FavoritesTable.userid).where(
            FavoritesTable.type == kind, FavoritesTable.hash.in_([f"{kind}_{old_hash}", old_hash])
        )
    ).all()

    for row_id, userid in rows:
        taken = session.execute(
            select(FavoritesTable.id).where(
                FavoritesTable.userid == userid, FavoritesTable.hash.in_([new_key, new_hash])
            )
        ).first()
        if taken:
            session.execute(delete(FavoritesTable).where(FavoritesTable.id == row_id))
        else:
            session.execute(update(FavoritesTable).where(FavoritesTable.id == row_id).values(hash=new_key))

    if rows:
        log.info("Tag edit: %s favourite(s) moved from %s %s to %s", len(rows), kind, old_hash, new_hash)


def migrate_track_references(old_trackhash: str, new_trackhash: str, session: Any = None) -> None:
    """
    Repoint every reference from ``old_trackhash`` to ``new_trackhash``.

    Covers playlists, favorites and the scrobble/play-history table for ALL users,
    in a single transaction so the update is atomic. Pass ``session`` to run in
    a transaction the caller already holds: a tag edit swaps the track row in
    the same one, so a failure can never leave the row and its references
    disagreeing.
    """
    if not old_trackhash or not new_trackhash or old_trackhash == new_trackhash:
        return

    if session is not None:
        _migrate(session, old_trackhash, new_trackhash)
        return

    from aivinnet.db.engine import DbEngine

    with DbEngine.manager(commit=True) as own_session:
        _migrate(own_session, old_trackhash, new_trackhash)


def _migrate(session: Any, old_trackhash: str, new_trackhash: str) -> None:
    from sqlalchemy import delete, select, update

    from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable

    old_fav = f"track_{old_trackhash}"
    new_fav = f"track_{new_trackhash}"

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
        row.userid for row in session.execute(select(FavoritesTable.userid).where(FavoritesTable.hash == old_fav)).all()
    }
    new_owners = {
        row.userid for row in session.execute(select(FavoritesTable.userid).where(FavoritesTable.hash == new_fav)).all()
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
                delete(FavoritesTable).where(FavoritesTable.hash == old_fav, FavoritesTable.userid == userid)
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
