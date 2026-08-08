"""
Contains all the artist(s) routes.
"""

import math
import random
from collections import defaultdict
from datetime import datetime
from typing import Any

from flask_openapi3 import APIBlueprint, Tag
from pydantic import Field

from aivinnet.api.apischemas import (
    AlbumLimitSchema,
    ArtistHashSchema,
    ArtistLimitSchema,
    TrackLimitSchema,
)
from aivinnet.config import UserConfig
from aivinnet.db.userdata import SimilarArtistTable
from aivinnet.lib.sortlib import sort_tracks
from aivinnet.serializers.album import serialize_for_card_many
from aivinnet.serializers.artist import serialize_for_card, serialize_for_cards
from aivinnet.serializers.track import serialize_track
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.stats import get_track_group_stats

bp_tag = Tag(name="Artist", description="Single artist")
api = APIBlueprint("artist", __name__, url_prefix="/artist", abp_tags=[bp_tag])


class GetArtistAlbumsQuery(AlbumLimitSchema):
    all: bool = Field(description="Whether to ignore albumlimit and return all albums", default=False)


class GetArtistQuery(TrackLimitSchema, GetArtistAlbumsQuery):
    albumlimit: int = Field(7, description="The number of albums to return")


def genres_with_decade(artist) -> list[dict[str, str]]:
    """
    The artist's genres, with a decade chip ("80s") in front when its date says so.

    Shared by the artist page and the Now Playing summary. It is one function
    because the two must not disagree: the panel sits next to the artist page,
    and a decade chip that appears on one and not the other reads as a bug in
    whichever one the user looked at second.
    """
    # ⚠️ `date == 0` means UNKNOWN, not 1970 — and `fromtimestamp(0).year` is
    # 1970, which the old `if year:` check happily accepted. Every artist without
    # a date therefore got a "70s" chip it had no claim to. Checking the
    # timestamp instead of the derived year is the whole fix.
    if not artist.date:
        return [*artist.genres]

    try:
        year = datetime.fromtimestamp(artist.date).year
    except (ValueError, OverflowError, OSError):
        # Out-of-range values come from bad tags; no chip beats a wrong one.
        return [*artist.genres]

    decade = str(math.floor(year / 10) * 10)[2:] + "s"
    return [{"name": decade, "genrehash": decade}, *artist.genres]


@api.get("/<string:artisthash>")
def get_artist(path: ArtistHashSchema, query: GetArtistQuery):
    """
    Get artist

    Returns artist data, tracks and genres for the given artisthash.
    """
    artisthash = path.artisthash
    limit = query.limit

    entry = ArtistStore.artistmap.get(artisthash)

    if entry is None:
        return {"error": "Artist not found"}, 404

    tracks = TrackStore.get_tracks_by_trackhashes(entry.trackhashes)
    tracks = sort_tracks(tracks, key="playcount", reverse=True)
    tcount = len(tracks)

    artist = entry.artist
    if artist.albumcount == 0 and tcount < 10:
        limit = tcount

    genres = genres_with_decade(artist)

    stats = get_track_group_stats(tracks)
    duration = sum(t.duration for t in tracks) if tracks else 0
    tracks = tracks[:limit] if (limit and limit != -1) else tracks
    tracks = [
        {
            **serialize_track(t),
            "help_text": ("unplayed" if t.playcount == 0 else f"{t.playcount} play{'' if t.playcount == 1 else 's'}"),
        }
        for t in tracks
    ]

    query.limit = query.albumlimit
    albums = get_artist_albums(path, query)

    return {
        "artist": {
            **serialize_for_card(artist),
            "duration": duration,
            "trackcount": tcount,
            "albumcount": artist.albumcount,
            "genres": genres,
            "is_favorite": artist.is_favorite,
        },
        "tracks": tracks,
        "albums": albums,
        "stats": stats,
    }


@api.get("/<string:artisthash>/summary")
def get_artist_summary(path: ArtistHashSchema):
    """
    Get artist summary

    The counts and genres for an artist, without its tracks or albums.

    ⚠️ This exists because `GET /artist/<hash>` is expensive and the Now Playing
    panel asks on every artist change. That route loads every track of the
    artist, sorts them by playcount, computes group stats and fetches the albums
    — work this server does on its ONLY thread, so a caller that just wants
    "12 albums, 143 tracks" would block playback for everyone.

    Everything here comes from the in-memory artist map: the entry itself plus
    `len(trackhashes)`. No track objects are built.
    """
    entry = ArtistStore.artistmap.get(path.artisthash)

    if entry is None:
        return {"error": "Artist not found"}, 404

    artist = entry.artist

    return {
        "artist": {
            # `serialize_for_card` drops the play counters by default; the panel
            # is the reason they are asked for, so they are included here.
            **serialize_for_card(artist, include={"playcount", "lastplayed"}),
            # Same list the artist page builds, decade chip included — see
            # `genres_with_decade` for why that is not duplicated here.
            "genres": genres_with_decade(artist),
            # ⚠️ This counts the hashes the store INDEXED, while the artist page
            # counts the tracks it could RESOLVE from them
            # (`get_tracks_by_trackhashes` drops hashes it does not know). The two
            # can differ by the dead hashes an entry keeps after a tag edit —
            # `track_edit._reconcile_artist` leaves an entry in place while the
            # artist is still referenced elsewhere. Resolving them here would mean
            # loading every track, which is the one thing this route exists to
            # avoid, so the cheap count is deliberate and may run slightly high
            # until the next index.
            "trackcount": len(entry.trackhashes),
            "albumcount": artist.albumcount,
            "is_favorite": artist.is_favorite,
        }
    }


@api.get("/<artisthash>/albums")
def get_artist_albums(path: ArtistHashSchema, query: GetArtistAlbumsQuery):
    """
    Get artist albums.
    """
    return_all = query.all
    artisthash = path.artisthash

    limit = query.limit

    entry = ArtistStore.artistmap.get(artisthash)

    if entry is None:
        return {"error": "Artist not found"}, 404

    albums = AlbumStore.get_albums_by_hashes(entry.albumhashes)
    tracks = TrackStore.get_tracks_by_trackhashes(entry.trackhashes)

    missing_albumhashes = {t.albumhash for t in tracks if t.albumhash not in {a.albumhash for a in albums}}

    albums.extend(AlbumStore.get_albums_by_hashes(missing_albumhashes))
    albumdict = {a.albumhash: a for a in albums}

    config = UserConfig()
    # `itertools.groupby` only groups CONSECUTIVE runs, so it requires input
    # sorted by the key. `tracks` comes straight from the store and is not
    # sorted by albumhash, so an album was split across several groups:
    # check_type() ran repeatedly for the same album, each time with only a
    # fragment of its tracks, and the last call won — which fragment that was
    # depended on trackhash order, making the result effectively
    # non-deterministic. is_single() also tests `len(tracks) == 1`, so a
    # multi-track album could be classified as a single off a 1-track fragment.
    #
    # A dict groups in O(n) without sorting AND guarantees exactly one
    # check_type() call per album.
    album_tracks: dict[str, list] = defaultdict(list)
    for track in tracks:
        album_tracks[track.albumhash].append(track)

    for albumhash, group in album_tracks.items():
        album = albumdict.get(albumhash)

        if album:
            album.check_type(group, config.showAlbumsAsSingles)

    albums = [a for a in albumdict.values()]
    all_albums = sorted(albums, key=lambda a: a.date, reverse=True)

    res: dict[str, Any] = {
        "albums": [],
        "appearances": [],
        "compilations": [],
        "singles_and_eps": [],
    }

    for album in all_albums:
        if album.type == "single" or album.type == "ep":
            res["singles_and_eps"].append(album)
        elif album.type == "compilation":
            res["compilations"].append(album)
        elif album.albumhash in missing_albumhashes or artisthash not in album.artisthashes:
            res["appearances"].append(album)
        else:
            res["albums"].append(album)

    if return_all:
        limit = len(all_albums)

    # loop through the res dict and serialize the albums
    for key, value in res.items():
        res[key] = serialize_for_card_many(value[:limit])

    res["artistname"] = entry.artist.name
    return res


@api.get("/<artisthash>/tracks")
def get_all_artist_tracks(path: ArtistHashSchema):
    """
    Get artist tracks

    Returns all artists by a given artist.
    """
    tracks = ArtistStore.get_artist_tracks(path.artisthash)
    tracks = sort_tracks(tracks, key="playcount", reverse=True)
    tracks = [
        {
            **serialize_track(t),
            "help_text": ("unplayed" if t.playcount == 0 else f"{t.playcount} play{'' if t.playcount == 1 else 's'}"),
        }
        for t in tracks
    ]

    return tracks


@api.get("/<artisthash>/similar")
def get_similar_artists(path: ArtistHashSchema, query: ArtistLimitSchema):
    """
    Get similar artists.
    """
    limit = query.limit
    result = SimilarArtistTable.get_by_hash(path.artisthash)

    if result is None:
        return []

    similar = ArtistStore.get_artists_by_hashes(result.get_artist_hash_set())

    if len(similar) > limit:
        similar = random.sample(similar, min(limit, len(similar)))

    return serialize_for_cards(similar[:limit])
