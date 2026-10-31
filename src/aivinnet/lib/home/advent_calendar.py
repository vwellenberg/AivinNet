"""
The Advent calendar's answer for one user: reads the library and the
user's plays, keeps the doors decided so far, and serializes their albums.
The rules are in `lib/home/advent.py`.

RAM and cache only on the request path. The user's plays come from ONE
grouped query per user, cached until their next play (`change_marker`, as
`first_play_cache`); the albums come from `AlbumStore`. Doors are decided once
per user and year, and a decided door keeps its album until the server
restarts or its album leaves the library.
"""

from datetime import date

import pendulum

from aivinnet.db.userdata import ScrobbleTable
from aivinnet.lib.home.advent import AdventAlbum, advent_day, advent_picks
from aivinnet.lib.home.recover_items import HOME_ALBUM_OMIT
from aivinnet.lib.recipes.homerows import UNKNOWN_ARTISTS, track_facts
from aivinnet.serializers.album import album_serializer
from aivinnet.store.albums import AlbumStore

# userid -> (change marker, albumhash -> (plays, last played)).
_plays: dict[int, tuple[tuple[int, int], dict[str, tuple[int, int]]]] = {}
# (userid, year) -> door -> albumhash.
_made: dict[tuple[int, int], dict[int, str]] = {}


def _album_plays(userid: int) -> dict[str, tuple[int, int]]:
    marker = ScrobbleTable.change_marker(userid)
    cached = _plays.get(userid)
    if cached is not None and cached[0] == marker:
        return cached[1]

    totals: dict[str, tuple[int, int]] = {}
    for trackhash, (plays, last) in ScrobbleTable.plays_by_trackhash_of(userid).items():
        facts = track_facts(trackhash)
        if facts is None:
            continue
        # A play counts for every edition of the track (`TrackFacts.other_albums`).
        for albumhash in {facts.albumhash, *facts.other_albums}:
            count, latest = totals.get(albumhash, (0, 0))
            totals[albumhash] = (count + plays, max(latest, last))

    _plays[userid] = (marker, totals)
    return totals


def _library(userid: int) -> list[AdventAlbum]:
    # A snapshot: a scan may add albums to the live dict while this runs (#391).
    played = _album_plays(userid)
    return [
        AdventAlbum(
            albumhash=albumhash,
            artists=tuple(a["artisthash"] for a in entry.album.albumartists),
            plays=played.get(albumhash, (0, 0))[0],
            last_played=played.get(albumhash, (0, 0))[1],
        )
        for albumhash, entry in list(AlbumStore.albummap.items())
    ]


def _decided(userid: int, year: int) -> dict[int, str]:
    # Only the current year is kept: the other years are over.
    for key in [k for k in _made if k[1] != year]:
        del _made[key]
    return _made.setdefault((userid, year), {})


def advent_calendar(userid: int, today: date) -> dict:
    """
    `{"day": 1..24 or 0, "doors": [{"day", "album"}, …]}`: the doors up to
    today, each with its album serialized as a Home card. Outside December
    1 to 24 there are no doors.
    """
    day = advent_day(today)
    if day == 0:
        return {"day": 0, "doors": []}

    made = _decided(userid, today.year)
    # A door whose album left the library is decided again.
    for door, albumhash in list(made.items()):
        if albumhash not in AlbumStore.albummap:
            del made[door]

    if any(door not in made for door in range(1, day + 1)):
        now = pendulum.now().timestamp()
        picks = advent_picks(
            _library(userid),
            userid,
            today.year,
            day,
            now,
            made=made,
            skip=UNKNOWN_ARTISTS.__contains__,
        )
        made.update(picks)

    doors = []
    for door in range(1, day + 1):
        album = AlbumStore.get_album_by_hash(made[door]) if door in made else None
        if album is None:
            # An empty library has no doors to open.
            continue
        doors.append({"day": door, "album": album_serializer(album, to_remove=set(HOME_ALBUM_OMIT))})

    return {"day": day, "doors": doors}


def forget(userid: int) -> None:
    """Drop a deleted user's plays and doors: SQLite gives their id to the next user created."""
    _plays.pop(userid, None)
    for key in [k for k in _made if k[0] == userid]:
        del _made[key]
