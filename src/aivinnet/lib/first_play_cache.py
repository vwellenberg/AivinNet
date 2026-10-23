"""
Each user's first play of every album and artist (#539), kept until their
next play. The history is grouped in SQL, but the stats page asks for it per
period, both chart captions ask, and Home asks which recently added albums
the user has not played yet (#533). Like Rewind, a rescan that moves tracks to
other albums shows on the next play, not at once.
"""

from aivinnet.db.userdata import ScrobbleTable
from aivinnet.lib.discoveries import FirstPlays, first_plays
from aivinnet.lib.placeholder_artists import PLACEHOLDER_ARTIST_HASHES
from aivinnet.store.albums import AlbumStore
from aivinnet.store.tracks import TrackStore

_first_plays: dict[int, tuple[tuple[int, int], FirstPlays]] = {}


def _resolve_track(trackhash: str) -> tuple[str, list[str]] | None:
    """A track's album (as the album pages know it) and the artists on it, None once it left the library."""
    group = TrackStore.trackhashmap.get(trackhash)
    if group is None:
        return None
    track = group.tracks[0]
    entry = AlbumStore.albummap.get(track.albumhash)
    if entry is None:
        return None
    return entry.album.albumhash, [artist["artisthash"] for artist in track.artists]


def first_plays_of(userid: int) -> FirstPlays:
    marker = ScrobbleTable.change_marker(userid)
    cached = _first_plays.get(userid)
    if cached is None or cached[0] != marker:
        first = ScrobbleTable.first_play_by_trackhash_of(userid)
        cached = (marker, first_plays(first, _resolve_track, PLACEHOLDER_ARTIST_HASHES.__contains__))
        _first_plays[userid] = cached
    return cached[1]


def forget(userid: int) -> None:
    """Drop a deleted user's first plays: SQLite gives their id to the next user created."""
    _first_plays.pop(userid, None)
