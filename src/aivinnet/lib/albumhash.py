"""
How a track is assigned to an album, and what that album is called.

The rules live together because they have to agree with each other: the scanner
writes rows with them, and the repair migrations find rows to fix with them. If
those drifted apart, a migration would either miss affected rows or rewrite rows
the scanner immediately re-breaks.

Deliberately free of database imports so both the scanner and the tests can use
it without dragging in the ORM.
"""

import os

from aivinnet.utils.hashing import create_hash


def album_hash(album_tag: str | None, folder: str, albumartists: str) -> str:
    """
    The album a track belongs to.

    The album tag identifies the album. When a file has none, the FOLDER stands
    in: files that sit together in a directory are one album far more often than
    they are thousands of tracks called "Unknown".

    What must never go in here is the track's resolved album *title*: when the
    tag is missing, the scanner fills that field from the FILENAME, so it holds
    the track's own title. Hashing it would give every untagged file an album of
    its own — and it would change the trackhash (derived from the same field),
    taking every playlist, favourite and scrobble that points at those tracks
    with it.
    """
    return create_hash(album_tag or folder, albumartists)


def album_title(album_tag: str | None, folder: str) -> str | None:
    """
    What the album is CALLED when the file carries no album tag.

    The folder's own name — `…/700-Games/Hearthstone` becomes "Hearthstone".

    Before this, a missing album tag fell back to the parsed FILENAME, i.e. the
    track's own title. That was already wrong on its own (an album named after
    one of its tracks) and became conspicuous once the hash started grouping by
    folder: hundreds of correctly grouped albums, each named after whichever
    track happened to be first.

    Returns None when there is nothing usable, leaving the caller's existing
    "Unknown" fallback in charge.
    """
    if album_tag:
        return album_tag

    return os.path.basename(folder.rstrip("/\\")) or None


def broken_album_hash(albumartists: str) -> str:
    """
    The hash a track was given before the fallback existed: the EMPTY STRING
    joined with the album artist.

    This is the signature the repair uses to recognise an affected row. The raw
    tag is long gone by the time a row is in the database, but the hash it
    produced is still there — and it is unmistakable, because no real album tag
    hashes to the same value as no tag at all.

    Measured on a real library before the fix: 4718 tracks matched it, 4043 of
    them in one album spanning 208 different folders.
    """
    return create_hash("", albumartists)
