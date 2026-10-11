"""
Carry references across a rescan that changed a track's hash (#433).

A track's hash is derived from its tags. A tag change made OUTSIDE the app
(an external tagger, a batch write) keeps the file's path and changes the hash
on the next scan. Favourites, scrobbles and playlists still hold the old hash,
so they point at nothing. The app's own tag edits carry them across
(`lib/reference_migration.py`); a scan does not, unless it is told the old
hashes. This module works out which old hash became which new one, by path.

Pure on purpose: no database, no stores, so the fast test lane can run it.
"""

from collections.abc import Iterable, Mapping


def hashes_by_path(groups: Mapping[str, object]) -> dict[str, str]:
    """
    filepath -> the trackhash the running server gives that file.

    `groups` is `TrackStore.trackhashmap`: trackhash -> a group of tracks, each
    with `.filepath` and `.trackhash`.
    """
    out: dict[str, str] = {}

    for group in groups.values():
        tracks: Iterable = group.tracks  # type: ignore[attr-defined]
        for track in tracks:
            out[track.filepath] = track.trackhash

    return out


def remap_by_path(before: Mapping[str, str], after: Mapping[str, str]) -> dict[str, str]:
    """
    old hash -> new hash, for every file that kept its path and got a new hash.

    Two cases are left out, because moving their references would be wrong:

    - the old hash still names a file after the scan (another, unchanged file
      with the same tags still holds it, so its references are still right);
    - the old hash was spread over two or more new hashes (one reference cannot
      follow two different tracks; see track-tags.md, "Ein Hash, mehrere Dateien").

    A file that disappeared from the library is not remapped either.
    """
    present = set(after.values())
    targets: dict[str, set[str]] = {}

    for path, old in before.items():
        new = after.get(path)

        if new is None or new == old or old in present:
            continue

        targets.setdefault(old, set()).add(new)

    return {old: next(iter(news)) for old, news in targets.items() if len(news) == 1}
