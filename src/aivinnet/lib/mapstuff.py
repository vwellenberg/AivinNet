from typing import Any

from aivinnet.db.userdata import FavoritesTable, LibDataTable, ScrobbleTable
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore


def map_scrobble_data():
    """
    Maps scrobble data to the in-memory stores.

    The scrobble data is loaded from the database and grouped by trackhash.
    The album and artist scrobble data (for those tracks) are then incremented based on the data.
    """
    # Every user's plays, as `log_track` adds them while the server runs. The
    # user-less `get_all` read only user 1 off a request, so after each
    # restart everyone else's plays were gone from the counts (#391).
    grouped: dict[str, dict[str, Any]] = {
        trackhash: {"playcount": count, "playduration": duration or 0, "lastplayed": last}
        for trackhash, count, duration, last in ScrobbleTable.plays_by_trackhash()
    }

    # increment playcount, playduration and lastplayed for albums and artists
    for trackhash, data in grouped.items():
        track = TrackStore.trackhashmap.get(trackhash)

        if track is None:
            continue

        track.increment_playcount(data["playduration"], data["lastplayed"], data["playcount"])

        album = AlbumStore.albummap.get(track.tracks[0].albumhash)
        if album:
            album.increment_playcount(data["playduration"], data["lastplayed"], data["playcount"])

        for artisthash in track.tracks[0].artisthashes:
            artist = ArtistStore.artistmap.get(artisthash)
            if artist:
                artist.increment_playcount(data["playduration"], data["lastplayed"], data["playcount"])


def map_favorites():
    """
    Maps favorites data to the in-memory stores.
    """
    # Every user's rows, deliberately: this runs at startup to build the
    # in-memory stores, and `toggle_favorite_user(entry.userid)` below files
    # each one under its owner. There is no current user to scope to here.
    favorites = FavoritesTable.get_all(with_user=False)

    for entry in favorites:
        if entry.type == "album":
            album = AlbumStore.albummap.get(entry.hash)
            if album:
                album.toggle_favorite_user(entry.userid)

        elif entry.type == "artist":
            artist = ArtistStore.artistmap.get(entry.hash)
            if artist:
                artist.toggle_favorite_user(entry.userid)

        elif entry.type == "track":
            track = TrackStore.trackhashmap.get(entry.hash)
            if track:
                track.toggle_favorite_user(entry.userid)


def map_artist_colors():
    colors = LibDataTable.get_all_colors(type="artist")

    for color in colors:
        artist = ArtistStore.artistmap.get(color["itemhash"])

        if artist:
            artist.set_color(color["color"])


def map_album_colors():
    colors = LibDataTable.get_all_colors(type="album")

    for color in colors:
        album = AlbumStore.albummap.get(color["itemhash"])

        if album:
            album.set_color(color["color"])
