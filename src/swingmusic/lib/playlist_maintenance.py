"""
Pure helpers for maintaining a playlist's trackhash list.

Kept dependency-free so they can be unit-tested without importing the heavy
store/db modules.
"""

from collections.abc import Container, Iterable


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
