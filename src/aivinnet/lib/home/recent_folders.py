"""
What a folder of "Recently added" (Home) shows when it is neither an album nor
an artist: a folder card ("NEW MUSIC") or the new tracks themselves.

Pure on purpose (no store, no database), so the fast test lane imports it.
"""

from collections.abc import Collection, Iterable, Sequence
from pathlib import Path
from typing import Protocol, TypeVar

# A day of slack, like the album/artist check: files copied one after the
# other belong to the same arrival.
NEW_TOLERANCE_SECONDS = 86_400

# Fewer new files than this are shown as tracks, not as a folder card.
MIN_FOLDER_TRACKS = 3


class AddedTrack(Protocol):
    added: float


T = TypeVar("T", bound=AddedTrack)


def fresh_batch(tracks: Sequence[T]) -> list[T]:
    """
    The tracks that came in with the newest one (within a day of it).

    A folder's group holds every track that ever landed in it, so one new
    song beside 50 old ones made the whole folder "NEW MUSIC".
    """
    if not tracks:
        return []

    newest = max(t.added for t in tracks)
    return [t for t in tracks if t.added >= newest - NEW_TOLERANCE_SECONDS]


def root_prefixes(root_dirs: Iterable[str], home: Path) -> set[str]:
    """The library roots as the `/`-terminated POSIX prefixes `Track.folder` uses."""
    prefixes = set()
    for root in root_dirs:
        path = home if root == "$home" else Path(root)
        try:
            prefixes.add(path.resolve().as_posix().rstrip("/") + "/")
        except (OSError, RuntimeError, ValueError):
            prefixes.add(path.as_posix().rstrip("/") + "/")
    return prefixes


def show_as_folder(folder: str, new_tracks: Sequence[AddedTrack], roots: Collection[str]) -> bool:
    """
    A folder card only for a real batch of new files in a folder that is not a
    library root: a root's card is the whole library ("music, 12837 Tracks").
    """
    if (folder.rstrip("/") + "/") in roots:
        return False
    return len(new_tracks) >= MIN_FOLDER_TRACKS
