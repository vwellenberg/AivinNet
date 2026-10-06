# from tqdm import tqdm

import itertools
import json
from collections.abc import Callable, Iterable

from aivinnet.db.libdata import TrackTable
from aivinnet.models import Track
from aivinnet.utils import classproperty
from aivinnet.utils.auth import get_current_userid
from aivinnet.utils.remove_duplicates import remove_duplicates

TRACKS_LOAD_KEY = ""


class TrackGroup:
    """
    Tracks grouped under the same trackhash.
    """

    def __init__(self, tracks: list[Track]):
        self.tracks = tracks

    def append(self, track: Track):
        """
        Adds a track to the group.
        """
        self.tracks.append(track)

    def remove(self, track: Track):
        """
        Removes a track from the group.
        """
        self.tracks.remove(track)

    def increment_playcount(self, duration: int, timestamp: int, playcount: int = 1):
        """
        Increments the playcount of all tracks in the group.
        """
        for track in self.tracks:
            track.playcount += playcount
            track.lastplayed = timestamp
            track.playduration += duration

    def toggle_favorite_user(self, userid: int | None = None):
        """
        Adds or removes a user from the list of users who have favorited the track.
        """
        if userid is None:
            userid = get_current_userid()

        for track in self.tracks:
            track.toggle_favorite_user(userid)

    def set_favorite_user(self, favorited: bool, userid: int | None = None):
        """
        Set the favorite state of the group explicitly, instead of flipping it.

        A toggle cannot express "make this match the database": repeating a
        write that the database treats as a no-op would flip the store away from
        it. Callers that know the outcome of a write use this.
        """
        if userid is None:
            userid = get_current_userid()

        for track in self.tracks:
            if (userid in track.fav_userids) != favorited:
                track.toggle_favorite_user(userid)

    def get_best(self):
        """
        Returns the track with higest bitrate.
        """
        return max(self.tracks, key=lambda x: x.bitrate)

    def __len__(self):
        return len(self.tracks)


class TrackStore:
    # {'trackhash': Track[]}
    trackhashmap: dict[str, TrackGroup] = dict()

    # filepath -> tracks, for the lookups that arrive with a PATH in a request:
    # every ranged chunk of a stream, the silence probe, tag edits. Without it
    # each of them walked the whole store on the single request thread (#295).
    # Never trusted blindly — a hit is checked against the track itself — so
    # none of the many places that mutate the store has to keep it in step.
    _by_filepath: dict[str, list[Track]] = dict()

    @classproperty
    def tracks(cls) -> list[Track]:
        return cls.get_flat_list()

    @classmethod
    def get_flat_list(cls):
        """
        Returns a flat list of all tracks.
        """
        return list(itertools.chain.from_iterable([group.tracks for group in cls.trackhashmap.values()]))

    @classmethod
    def load_all_tracks(cls, instance_key: str):
        """
        Loads all tracks from the database into the store.
        """

        print("Loading tracks... ", end="")
        global TRACKS_LOAD_KEY
        TRACKS_LOAD_KEY = instance_key

        cls.trackhashmap = dict()
        tracks = TrackTable.get_all()

        # INFO: Load all tracks into the dict store
        for track in tracks:
            if instance_key != TRACKS_LOAD_KEY:
                return

            exists = cls.trackhashmap.get(track.trackhash, None)
            if not exists:
                cls.trackhashmap[track.trackhash] = TrackGroup([track])
            else:
                cls.trackhashmap[track.trackhash].append(track)

        print("Done!")

    @classmethod
    def add_track(cls, track: Track):
        """
        Adds a single track to the store.
        """
        group = cls.trackhashmap.get(track.trackhash, None)

        if group:
            return group.append(track)

        cls.trackhashmap[track.trackhash] = TrackGroup([track])

    @classmethod
    def add_tracks(cls, tracks: list[Track]):
        """
        Adds multiple tracks to the store.
        """

        for track in tracks:
            cls.add_track(track)

    @classmethod
    def remove_track(cls, track: Track):
        """
        Removes a single track from the store.
        """
        group = cls.trackhashmap.get(track.trackhash, None)

        if group:
            group.remove(track)

            if len(group) == 0:
                del cls.trackhashmap[track.trackhash]

    @classmethod
    def remove_track_by_filepath(cls, filepath: str):
        """
        Removes a track from the store by its filepath.
        """

        return cls.remove_tracks_by_filepaths({filepath})

    @classmethod
    def remove_tracks_by_filepaths(cls, filepaths: set[str]):
        """
        Removes multiple tracks from the store by their filepaths.
        """

        filecount = len(filepaths)

        # Iterate over copies: the loop deletes from trackhashmap (empty groups)
        # and removes from group.tracks, which would otherwise raise
        # "dictionary changed size during iteration" / skip elements.
        for trackhash in list(cls.trackhashmap):
            group = cls.trackhashmap[trackhash]

            for track in list(group.tracks):
                if track.filepath in filepaths:
                    group.remove(track)

                    if len(group) == 0:
                        del cls.trackhashmap[trackhash]

                    filecount -= 1

                if filecount == 0:
                    break

    @classmethod
    def count_tracks_by_trackhash(cls, trackhash: str) -> int:
        """
        Counts the number of tracks with a specific trackhash.
        """
        return len(cls.trackhashmap.get(trackhash, []))

    # ================================================
    # ================== GETTERS =====================
    # ================================================

    @classmethod
    def get_tracks_by_trackhashes(cls, trackhashes: Iterable[str]) -> list[Track]:
        """
        Returns a list of tracks by their hashes.
        """
        hash_set = set(trackhashes)
        tracks: list[Track] = []

        for trackhash in hash_set:
            group = cls.trackhashmap.get(trackhash, None)

            if group:
                track = group.get_best()
                tracks.append(track)

        # sort the tracks in the order of the given trackhashes (first occurrence;
        # a position map instead of list.index, which made this quadratic)
        if type(trackhashes) is list:
            position: dict[str, int] = {}
            for index, trackhash in enumerate(trackhashes):
                position.setdefault(trackhash, index)
            tracks.sort(key=lambda t: position[t.trackhash])

        return tracks

    @classmethod
    def _indexed(cls, path: str) -> list[Track] | None:
        """
        The index's tracks for `path`, or None when it has none or any of them
        went stale (renamed in place, removed from the store).
        """
        hits = cls._by_filepath.get(path)
        if not hits:
            return None

        for track in hits:
            group = cls.trackhashmap.get(track.trackhash)
            if track.filepath != path or group is None or not any(t is track for t in group.tracks):
                return None

        return hits

    @classmethod
    def get_tracks_by_filepaths(cls, paths: Iterable[str]) -> list[Track]:
        """
        Returns all tracks matching the given paths.

        Answered from the filepath index. Only a path the index does not hold
        (yet, or any more) costs a full pass over the store, and that pass
        rebuilds the index, so the next request for it is a dict lookup.
        """
        tracks: list[Track] = []
        unknown: list[str] = []

        for path in dict.fromkeys(paths):  # each path once, in order
            hits = cls._indexed(path)
            if hits is None:
                unknown.append(path)
            else:
                tracks.extend(hits)

        if unknown:
            index: dict[str, list[Track]] = {}
            # `list()` snapshots the groups: the indexer may add or drop
            # one from another thread while this runs.
            for group in list(cls.trackhashmap.values()):
                for track in group.tracks:
                    index.setdefault(track.filepath, []).append(track)

            cls._by_filepath = index
            for path in unknown:
                tracks.extend(index.get(path, ()))

        return tracks

    @classmethod
    def find_tracks_by(
        cls,
        key: str,
        value: str,
        predicate: Callable = lambda prop_value, value: prop_value == value,
        including_duplicates: bool = False,
    ):
        """
        Find all tracks by a specific key.
        """
        tracks: list[Track] = []

        for trackhash in cls.trackhashmap:
            group = cls.trackhashmap.get(trackhash, None)

            if not group:
                continue

            for track in group.tracks:
                prop_value = getattr(track, key)
                if predicate(prop_value, value):
                    tracks.append(track)

        if including_duplicates:
            return tracks

        return remove_duplicates(tracks)

    @classmethod
    def get_tracks_by_albumhash(cls, album_hash: str, including_duplicates: bool = False) -> list[Track]:
        """
        Returns all tracks matching the given album hash.

        By default files that share a trackhash collapse to one; with
        `including_duplicates` every FILE is returned.
        """
        return cls.find_tracks_by(key="albumhash", value=album_hash, including_duplicates=including_duplicates)

    @classmethod
    def get_tracks_by_artisthash(cls, artisthash: str):
        """
        Returns all tracks matching the given artist. Duplicate tracks are removed.
        """
        predicate = lambda artisthashes, artisthash: artisthash in artisthashes
        return cls.find_tracks_by(key="artisthashes", value=artisthash, predicate=predicate)

    @classmethod
    def get_tracks_in_path(cls, path: str):
        """
        Returns all tracks in the given path.
        """
        # The folder itself or one below it: a bare `startswith` also took
        # /music/Rock and Roll along with /music/Rock.
        base = path.rstrip("/\\")
        predicate: Callable[[str, str], bool] = lambda track_folder, _: (
            track_folder.rstrip("/\\") == base or (track_folder.startswith((base + "/", base + "\\")))
        )

        return cls.find_tracks_by(
            key="folder",
            value=path,
            predicate=predicate,
            including_duplicates=True,
        )

    @classmethod
    def get_recently_added(cls, start: int, limit: int | None):
        """
        Returns the most recently added tracks.
        """
        tracks = cls.get_flat_list()

        if limit is None:
            return sorted(tracks, key=lambda x: x.last_mod, reverse=True)[start:]

        return sorted(tracks, key=lambda x: x.last_mod, reverse=True)[start:limit]

    @classmethod
    def get_recently_played(cls, limit: int):
        tracks = cls.get_flat_list()
        return sorted(tracks, key=lambda x: x.lastplayed, reverse=True)[:limit]

    @classmethod
    def export(cls):
        path = "tracks.json"

        with open(path, "w") as f:
            data = [
                {
                    "title": t.title,
                    "album": t.album,
                    "artists": [a["name"] for a in t.artists],
                }
                for t in cls.get_flat_list()
            ]
            json.dump(data, f)
