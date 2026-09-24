"""
Artist names that stand for "nobody in particular" — and must never get a face.

The online artist-image lookup (`artistlib.get_artist_image_link`) accepts a
Deezer result whenever its name hashes like ours. For a placeholder name that
check is worthless: Deezer has an artist literally called "Unknown", and its
picture is the cover of a Chinese compilation CD. A library whose tags say
"Unknown" showed that cover as the face of every untagged song.

Compared by hash, not by string, because that is how the file on disk is named
(`<artisthash>.webp`) and because the hash already folds case and punctuation:
"Unknown", "<unknown>" and "[Unknown]" are the same artist to the app, so they
are the same placeholder here.

This module stays free of the store/DB chain on purpose, so the fast test lane
can import it.
"""

from pathlib import Path

from aivinnet.utils.hashing import create_hash

# "Various Artists" is in here although MusicBrainz treats it as a real credit
# (see `musicbrainz._PLACEHOLDER_ARTISTS`): for a *portrait* it is as empty as
# "Unknown" — a compilation has no single face to show.
PLACEHOLDER_ARTIST_NAMES = ("unknown", "unknown artist", "various artists")

PLACEHOLDER_ARTIST_HASHES = frozenset(create_hash(name, decode=True) for name in PLACEHOLDER_ARTIST_NAMES)


def is_placeholder_artist(name: str) -> bool:
    return create_hash(name, decode=True) in PLACEHOLDER_ARTIST_HASHES


def purge_placeholder_artist_images(folders: list[Path], user_set_dir: Path | None = None) -> list[Path]:
    """
    Delete cached images of placeholder artists; return what was removed.

    A picture the owner uploaded for "Unknown" on purpose is kept: it has a
    marker in `user_set_dir` (see `artist_image.py`).

    Needed besides the lookup guard because the guard only stops NEW downloads:
    an install that scanned with online metadata on still has the file, and the
    image server hands out whatever `<artisthash>.webp` it finds. Without the
    file the server falls back to the generic artist icon.
    """
    removed = []

    for folder in folders:
        for artisthash in PLACEHOLDER_ARTIST_HASHES:
            if user_set_dir is not None and (user_set_dir / artisthash).exists():
                continue

            path = folder / f"{artisthash}.webp"

            if path.exists():
                path.unlink()
                removed.append(path)

    return removed
