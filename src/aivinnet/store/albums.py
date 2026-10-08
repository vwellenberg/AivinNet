from collections.abc import Iterable

from aivinnet.lib.tagger import create_albums
from aivinnet.models import Album, Track
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid

ALBUM_LOAD_KEY = ""


class AlbumMapEntry:
    def __init__(self, album: Album, trackhashes: set[str]) -> None:
        self.album = album
        self.trackhashes = trackhashes

    @property
    def basetitle(self):
        return self.album.base_title

    def increment_playcount(self, duration: int, timestamp: int, playcount: int = 1):
        # The newest play, not the last one added: the startup aggregate
        # visits the tracks in hash order (#391).
        self.album.lastplayed = max(self.album.lastplayed or 0, timestamp)
        self.album.playduration += duration
        self.album.playcount += playcount

    def toggle_favorite_user(self, userid: int | None = None):
        if userid is None:
            userid = get_current_userid()

        self.album.toggle_favorite_user(userid)

    def set_favorite_user(self, favorited: bool, userid: int | None = None):
        """
        Set the favorite state explicitly instead of flipping it — see
        `TrackGroup.set_favorite_user` for why the toggle is not enough.
        """
        if userid is None:
            userid = get_current_userid()

        if (userid in self.album.fav_userids) != favorited:
            self.album.toggle_favorite_user(userid)

    def set_color(self, color: str):
        self.album.color = color


class AlbumStore:
    albummap: dict[str, AlbumMapEntry] = {}

    @classmethod
    def load_albums(cls, instance_key: str):
        """
        Loads all albums from the database into the store.
        """
        global ALBUM_LOAD_KEY
        ALBUM_LOAD_KEY = instance_key

        print("Loading albums... ", end="")

        cls.albummap = {
            album.albumhash: AlbumMapEntry(album=album, trackhashes=trackhashes)
            for album, trackhashes in create_albums()
        }
        print("Done!")

    @classmethod
    def index_new_album(cls, album: Album, trackhashes: set[str]):
        cls.albummap[album.albumhash] = AlbumMapEntry(album=album, trackhashes=trackhashes)

    @classmethod
    def get_flat_list(cls):
        """
        Returns a flat list of all albums.
        """
        # A snapshot first: an album apply adds keys from a worker thread, and a
        # comprehension over the live dict then raised "dictionary changed size
        # during iteration" in whichever request was reading (#391).
        return [a.album for a in list(cls.albummap.values())]

    @classmethod
    def get_album_by_hash(cls, albumhash: str) -> Album | None:
        """
        Returns an album by its hash.
        """
        entry = cls.albummap.get(albumhash)
        if entry is not None:
            return entry.album

    @classmethod
    def get_albums_by_hashes(cls, albumhashes: Iterable[str]) -> list[Album]:
        """
        Returns albums by their hashes.
        """
        albums = []
        for albumhash in albumhashes:
            entry = cls.albummap.get(albumhash)
            if entry is not None:
                albums.append(entry.album)

        return albums

    @classmethod
    def get_albums_by_artisthash(cls, hash: str):
        """
        Returns all albums by the given artist hash.
        """
        artist = ArtistStore.artistmap.get(hash)

        if not artist:
            return []

        # Tolerant of hashes the album map no longer has: a tag edit can pop an
        # album while an artist entry (e.g. "Various Artists") still lists it,
        # and every album page of that artist answered 500 until a restart.
        return [cls.albummap[h].album for h in artist.albumhashes if h in cls.albummap]

    @classmethod
    def get_albums_by_artisthashes(cls, hashes: Iterable[str]):
        """
        Returns all albums by the given artist hashes.
        """
        albums = []
        for hash in hashes:
            albums.extend(cls.get_albums_by_artisthash(hash))

        return albums

    @classmethod
    def get_album_tracks(cls, albumhash: str) -> list[Track]:
        """
        Returns all tracks for the given album hash.
        """
        album = cls.albummap.get(albumhash)
        if not album:
            return []

        return TrackStore.get_tracks_by_trackhashes(album.trackhashes)
