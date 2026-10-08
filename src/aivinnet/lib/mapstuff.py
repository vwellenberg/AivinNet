from aivinnet.db.userdata import FavoritesTable, LibDataTable, ScrobbleTable
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore


def map_scrobble_data():
    """
    Sets the play counts of the in-memory stores from the scrobble table.

    ⚠️ SETS, never adds (#391). This runs after a rescan has swapped in fresh
    tracks, albums and artists, and the server keeps serving meanwhile: a play
    logged in between (`log_track`) already counted itself on the fresh objects
    AND wrote its row. Adding the database totals on top counted that play
    twice. Setting them makes this a statement of the database, whatever ran
    before it. (A play logged between the read and the assignments below is
    missed in RAM until the next load; the row itself is safe. Closing that
    too would need a lock that `log_track` waits on, on the only request
    thread — a short undercount until the next start is the cheaper error.)
    """
    # Every user's plays, as `log_track` adds them while the server runs. The
    # user-less `get_all` read only user 1 off a request, so after each
    # restart everyone else's plays were gone from the counts (#391).
    albums: dict[str, list[int]] = {}
    artists: dict[str, list[int]] = {}

    for trackhash, count, duration, last in ScrobbleTable.plays_by_trackhash():
        group = TrackStore.trackhashmap.get(trackhash)

        if group is None:
            continue

        duration = duration or 0
        for track in group.tracks:
            track.playcount, track.playduration, track.lastplayed = count, duration, last

        first = group.tracks[0]
        _add_plays(albums, first.albumhash, count, duration, last)
        for artisthash in first.artisthashes:
            _add_plays(artists, artisthash, count, duration, last)

    for albumhash, (count, duration, last) in albums.items():
        entry = AlbumStore.albummap.get(albumhash)
        if entry:
            entry.album.playcount, entry.album.playduration, entry.album.lastplayed = count, duration, last

    for artisthash, (count, duration, last) in artists.items():
        entry = ArtistStore.artistmap.get(artisthash)
        if entry:
            entry.artist.playcount, entry.artist.playduration, entry.artist.lastplayed = count, duration, last


def _add_plays(totals: dict[str, list[int]], key: str, count: int, duration: int, last: int) -> None:
    """Sum one track's plays into an album's or artist's totals; the newest play wins."""
    entry = totals.setdefault(key, [0, 0, 0])
    entry[0] += count
    entry[1] += duration
    entry[2] = max(entry[2], last or 0)


def map_favorites():
    """
    Maps favorites data to the in-memory stores.
    """
    # Every user's rows, deliberately: this runs at startup to build the
    # in-memory stores, and `set_favorite_user(True, entry.userid)` below files
    # each one under its owner. There is no current user to scope to here.
    favorites = FavoritesTable.get_all(with_user=False)

    # ⚠️ SET, never toggle (#391): a favorite added after a rescan swapped in
    # the fresh stores already set itself there (`/favorites/add`), and a
    # toggle for its row here flipped it straight back off. (One removed
    # while this loop runs, after its row was read, comes back in RAM until
    # the next load — the same narrow window as in `map_scrobble_data`.)
    for entry in favorites:
        if entry.type == "album":
            album = AlbumStore.albummap.get(entry.hash)
            if album:
                album.set_favorite_user(True, entry.userid)

        elif entry.type == "artist":
            artist = ArtistStore.artistmap.get(entry.hash)
            if artist:
                artist.set_favorite_user(True, entry.userid)

        elif entry.type == "track":
            track = TrackStore.trackhashmap.get(entry.hash)
            if track:
                track.set_favorite_user(True, entry.userid)


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
