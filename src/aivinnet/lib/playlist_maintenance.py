"""
Pure helpers for maintaining a playlist's trackhash list.

Kept dependency-free so they can be unit-tested without importing the heavy
store/db modules.
"""

from collections import Counter
from collections.abc import Container, Iterable
from typing import Any


class TrackhashNotInPlaylist(ValueError):
    """Raised when a move references a trackhash the playlist does not store."""

    def __init__(self, trackhash: str, role: str = "trackhash"):
        self.trackhash = trackhash
        self.role = role
        super().__init__(f"{role} '{trackhash}' is not in this playlist")


def move_trackhash(
    trackhashes: list[str],
    trackhash: str,
    before_trackhash: str | None,
) -> list[str]:
    """
    Return `trackhashes` with `trackhash` moved so it sits immediately before
    `before_trackhash` (or at the end when that is None).

    Anchoring the move on the *neighbouring trackhash* instead of submitting a
    whole new list is what makes reordering safe:

    - The client only ever has the tracks it has paginated in, and never sees
      orphan hashes at all. A full-list submit therefore silently DELETED every
      hash the client didn't know about (measured: a 120-track playlist dropped
      to 44 after a single drag).
    - Both anchors here are by definition loaded, because a drag can only happen
      between two rendered rows — so the payload stays O(1) and every unlisted
      or unresolvable hash keeps its place.

    Raises `TrackhashNotInPlaylist` if either hash is missing.
    """
    if trackhash not in trackhashes:
        raise TrackhashNotInPlaylist(trackhash)

    if before_trackhash is not None and before_trackhash not in trackhashes:
        raise TrackhashNotInPlaylist(before_trackhash, role="before_trackhash")

    if before_trackhash == trackhash:
        # "Move in front of yourself" is a no-op, not an error.
        return list(trackhashes)

    result = list(trackhashes)
    result.remove(trackhash)  # first occurrence

    if before_trackhash is None:
        result.append(trackhash)
        return result

    result.insert(result.index(before_trackhash), trackhash)
    return result


def trackhash_diff(submitted: Iterable[str], stored: Iterable[str]) -> tuple[list[str], list[str]]:
    """
    Compare two trackhash lists as multisets and return `(dropped, added)`:
    hashes the submitted list is missing relative to `stored`, and hashes it
    introduces. Both empty means the submission is a true permutation.

    Used to refuse a reorder that would silently destroy data.
    """
    stored_count = Counter(stored)
    submitted_count = Counter(submitted)

    dropped = sorted((stored_count - submitted_count).elements())
    added = sorted((submitted_count - stored_count).elements())

    return dropped, added


def remove_trackhashes(trackhashes: Iterable[str], items: Iterable[dict[str, Any]]) -> list[str]:
    """
    Remove one occurrence per entry in `items` (each `{"trackhash", "index"}`)
    and return the resulting list.

    The old inline implementation guarded with
    ``dbtrackhashes.index(trackhash) == item["index"]`` and skipped the removal
    otherwise. But the client's `index` counts *resolved* tracks while
    `.index()` returns the position in the *stored* list, which also holds
    orphan hashes — so a single orphan anywhere above the track made the guard
    fail and the removal SILENTLY DO NOTHING while still answering 200/"Done".

    The index is now only what it can honestly be: a hint used to pick the right
    occurrence should the same hash appear twice. If it doesn't match, the first
    occurrence is removed instead of nothing at all.
    """
    result = list(trackhashes)

    for item in items:
        trackhash = item.get("trackhash")

        if not trackhash or trackhash not in result:
            continue

        index = item.get("index")

        if isinstance(index, int) and 0 <= index < len(result) and result[index] == trackhash:
            result.pop(index)
        else:
            result.remove(trackhash)

    return result


def merge_trackhashes(existing: list[str], new: Iterable[str]) -> list[str]:
    """
    Append `new` trackhashes to `existing`, preserving order and dropping
    duplicates.

    The previous implementation used ``list(set(existing).union(new))`` which
    de-duplicated but also *scrambled the whole playlist order* on every append
    (Python set iteration order is arbitrary). This keeps the existing order
    intact and appends only genuinely new hashes at the end.
    """
    seen = set(existing)
    merged = list(existing)

    for trackhash in new:
        if trackhash not in seen:
            seen.add(trackhash)
            merged.append(trackhash)

    return merged


def record_added_at(
    added_at: dict[str, int] | None,
    existing: Iterable[str],
    merged: Iterable[str],
    timestamp: int,
) -> dict[str, int]:
    """
    Return a new `added_at` map (trackhash -> unix timestamp) with `timestamp`
    recorded for every hash in `merged` that is not in `existing`.

    Re-added hashes get a fresh timestamp (Spotify semantics: removing and
    re-adding a track resets its "date added").
    """
    result = dict(added_at or {})
    known = set(existing)

    for trackhash in merged:
        if trackhash not in known:
            result[trackhash] = timestamp

    return result


def prune_added_at(added_at: dict[str, int] | None, remaining: Iterable[str]) -> dict[str, int]:
    """
    Drop `added_at` entries whose trackhash is no longer in `remaining`, so the
    map does not accumulate stale keys after removals/orphan prunes.
    """
    keep = set(remaining)
    return {trackhash: ts for trackhash, ts in (added_at or {}).items() if trackhash in keep}


def prune_orphan_trackhashes(trackhashes: Iterable[str], resolvable: Container[str]) -> list[str]:
    """
    Return only the trackhashes that still resolve to a track in the library
    (i.e. are present in `resolvable`), preserving order.

    "Orphan" trackhashes are ones whose track no longer exists in the library
    (file removed / re-scanned to a different hash). They inflate a playlist's
    count and can desync the UI, so this lets a maintenance routine drop them.

    Only orphans are removed — resolvable entries (including any intentional
    duplicates) are kept untouched. De-duplication is the job of
    `merge_trackhashes` on append, not of an orphan prune.
    """
    return [trackhash for trackhash in trackhashes if trackhash in resolvable]
