"""
This library contains all the functions related to the search functionality.
"""

import heapq

from rapidfuzz import fuzz, process, utils
from unidecode import unidecode

from aivinnet import models
from aivinnet.models.album import Album
from aivinnet.models.artist import Artist
from aivinnet.models.folder import Folder
from aivinnet.models.playlist import Playlist
from aivinnet.models.track import Track
from aivinnet.serializers.album import serialize_for_card as serialize_album
from aivinnet.serializers.album import serialize_for_card_many as serialize_albums
from aivinnet.serializers.artist import serialize_for_card, serialize_for_cards
from aivinnet.serializers.track import serialize_track, serialize_tracks
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.remove_duplicates import remove_duplicates

# ratio = fuzz.ratio
# wratio = fuzz.WRatio

# INFO: Every search compares the query with every title of the library, and
# the server answers one request at a time (#295). The comparison is C++ and
# quick; transliterating each title with `unidecode` was Python and took most of
# the time (measured: 66 ms of a 90 ms track pass at 12k tracks, several times
# that on a Pi) — for every keystroke and every "load more". A title's choice
# string never changes, so it is made once. The stores are still read fresh on
# every search: nothing here can return a track that is gone.
_choices: dict[str, str] = {}
_MAX_CHOICES = 500_000  # far beyond any library; a bound against tag-edit churn


def _choice(text: str) -> str:
    """`text` as the fuzzy search compares it: transliterated, lowercased, then rapidfuzz's default processing."""
    choice = _choices.get(text)
    if choice is None:
        if len(_choices) >= _MAX_CHOICES:
            _choices.clear()
        choice = _choices[text] = utils.default_process(unidecode(text).lower())
    return choice


# The score bands `_rank` gives: the whole title, and the query as a word of it.
EXACT_MATCH = 100.0
WORD_MATCH = 90.0


def _rank(query: str, choices: list[str], cutoff: float, limit: int | None) -> list[tuple[int, float]]:
    """
    (index, score) of the choices that match `query`, best first.

    WRatio alone ranked by resemblance. Every title that merely looked like the
    query stood level with the one that contained it as a word: "saint" scored
    90 against "Saint Wenceslaus Theme" and 91 against "Saints", and with four
    track slots in the top results the song a person was after fell off the
    end. The score now says HOW the query sits in the title first, and WRatio
    only orders within that:

    - 100: the title is the query;
    - 90-99: every word of the query starts a word of the title ("saint",
      "saint theme"), a title that starts with it one point ahead;
    - 80-89: the query stands inside a word ("ndrom" in "Syndrome");
    - below 80: the title only resembles it — typos keep finding it.

    Both `query` and `choices` arrive processed (`_choice`, `default_process`).
    The cutoff applies to WRatio, as it always did.
    """
    # A one- or two-letter query resembles most of a library, and ranking all
    # of it here is a Python loop on the single request thread (measured 255 ms
    # against 158 at 50k titles for "a"). Its order among thousands of hits
    # says nothing yet, so it ranks only the WRatio top; from three letters on
    # every match takes part, which is where a word has to beat a lookalike.
    pool = max(limit * 4, 200) if limit is not None and len(query) < 3 else None
    matches = process.extract(query, choices, score_cutoff=cutoff, limit=pool, scorer=fuzz.WRatio)
    # " saint" inside " " + title: the query starts a word, without a regex. A
    # plain loop, not a scorer per item: for a one-letter query this runs over
    # most of the library on every keystroke. Several words match in any order
    # ("saint theme" finds "Theme of Saint Wenceslaus").
    needles = [" " + token for token in query.split()]
    single = needles[0] if len(needles) == 1 else None
    ranked: list[tuple[int, float]] = []

    for choice, wratio, index in matches:
        padded = " " + choice

        if choice == query:
            score = EXACT_MATCH
        elif (single in padded) if single else (needles and all(n in padded for n in needles)):
            score = WORD_MATCH + 8 * wratio / 100 + (1 if choice.startswith(query) else 0)
        elif query in choice:
            score = 80 + 9 * wratio / 100
        else:
            score = wratio * 0.79
        ranked.append((index, score))

    # Ties keep the order process.extract gave them.
    if limit is None:
        return sorted(ranked, key=lambda item: -item[1])
    return heapq.nlargest(limit, ranked, key=lambda item: item[1])


class Cutoff:
    """
    Holds all the default cutoff values.
    """

    tracks: int = 50
    albums: int = 50
    artists: int = 50
    playlists: int = 50
    folders: int = 50


class Limit:
    """
    Holds all the default limit values.
    """

    tracks: int = 150
    albums: int = 150
    artists: int = 150
    playlists: int = 150
    folders: int = 150


class SearchTracks:
    def __init__(self, query: str) -> None:
        self.query = query
        self.tracks = TrackStore.get_flat_list()

    def __call__(self, limit: int = Limit.tracks) -> list[models.Track]:
        """
        Gets all songs with a given title.
        """

        track_titles = [_choice(track.title) for track in self.tracks]
        results = _rank(utils.default_process(self.query), track_titles, Cutoff.tracks, limit)

        tracks: list[Track] = []

        for index, score in results:
            track = self.tracks[index]
            track._score = score
            tracks.append(track)

        return remove_duplicates(tracks)


class SearchArtists:
    def __init__(self, query: str) -> None:
        self.query = query
        self.artists = ArtistStore.get_flat_list()

    def __call__(self, limit: int = Limit.artists):
        """
        Gets all artists with a given name.
        """
        choices = [_choice(a.name) for a in self.artists]
        results = _rank(utils.default_process(self.query), choices, Cutoff.artists, limit)

        artists: list[Artist] = []

        for index, score in results:
            artist = self.artists[index]
            artist._score = score
            artists.append(artist)

        return artists


class SearchAlbums:
    def __init__(self, query: str) -> None:
        self.query = query
        self.albums = AlbumStore.get_flat_list()

    def __call__(self, limit: int = Limit.albums):
        """
        Gets all albums with a given title.
        """

        choices = [_choice(a.title) for a in self.albums]

        # INFO: WRatio, like tracks and artists. Albums used `token_sort_ratio`,
        # which compares the WHOLE title against the query: one word of a long
        # title scored far below the cutoff ("essentials" against "Kingdom Come:
        # Deliverance II - Soundtrack Essentials" is 34), so an album was only
        # found by typing most of its name. WRatio takes the best of the full,
        # the token and the partial comparison, scaled by the length ratio — the
        # word alone scores 90, the whole title still scores highest.
        results = _rank(utils.default_process(self.query), choices, Cutoff.albums, limit)

        albums: list[Album] = []

        for index, score in results:
            album = self.albums[index]
            album._score = score
            albums.append(album)

        return albums


class SearchPlaylists:
    def __init__(self, playlists: list[models.Playlist], query: str) -> None:
        self.playlists = playlists
        self.query = query

    def __call__(self, limit: int = Limit.playlists):
        choices = [utils.default_process(p.name) for p in self.playlists]
        results = _rank(utils.default_process(self.query), choices, Cutoff.playlists, limit)

        playlists: list[Playlist] = []

        for index, score in results:
            playlist = self.playlists[index]
            playlist._score = score
            playlists.append(playlist)

        return playlists


class SearchFolders:
    def __init__(self, query: str) -> None:
        self.query = query
        # (name, path) for every directory containing tracks, from the index.
        self.folders = FolderStore.get_folder_index()

    def __call__(self, limit: int = Limit.folders) -> list[Folder]:
        """
        Gets all folders whose name fuzzily matches the query.
        """
        choices = [_choice(name) for name, _ in self.folders]
        results = _rank(utils.default_process(self.query), choices, Cutoff.folders, limit)

        # Only compute track counts for the matched folders (cheap, in-memory).
        matched = [self.folders[index] for index, _score in results]
        counts = FolderStore.count_tracks_containing_paths([path for _, path in matched])
        count_map = {c["path"]: c["trackcount"] for c in counts}

        return [Folder(name=name, path=path, trackcount=count_map.get(path, 0)) for name, path in matched]


_type = models.Track | models.Album | models.Artist


def get_titles(items: list[_type]):
    for item in items:
        if isinstance(item, models.Track):
            text = item.og_title
        elif isinstance(item, models.Album):
            text = item.title
        elif isinstance(item, models.Artist):
            text = item.name
        else:
            text = None

        yield text


class TopResults:
    """
    Joins all tracks, albums and artists
    then fuzzy searches them as a single unit.
    """

    @staticmethod
    def collect_all():
        all_items: list[_type] = []

        all_items.extend(ArtistStore.get_flat_list())
        all_items.extend(TrackStore.get_flat_list())
        all_items.extend(AlbumStore.get_flat_list())

        return all_items, get_titles(all_items)

    @staticmethod
    def get_track_items(item: Track | Album | Artist | None, limit=5):
        tracks: list[Track] = []

        # INFO: If the item is a track, return empty list
        # to be filled by the results from the top search
        if isinstance(item, Track):
            return tracks

        # INFO: If the item is an album, get the tracks from the album
        if isinstance(item, Album):
            tracks = TrackStore.get_tracks_by_albumhash(item.albumhash)[:limit]
            tracks.sort(key=lambda x: x.playduration, reverse=True)
            return tracks

        # INFO: If the item is an artist, get the tracks from the artist
        if isinstance(item, Artist):
            tracks = TrackStore.get_tracks_by_artisthash(item.artisthash)[:limit]
            tracks.sort(key=lambda x: x.playduration, reverse=True)

        return tracks

    @staticmethod
    def get_album_items(item: Track | Album | Artist | None, limit=6):
        albums: list[Album] = []

        # INFO: If the item is a track or album, search for albums
        if isinstance(item, Track) or isinstance(item, Album):
            return albums

        # INFO: If the item is an artist, get the albums from the artist
        if isinstance(item, Artist):
            albums = AlbumStore.get_albums_by_artisthash(item.artisthash)[:limit]

        return albums

    @staticmethod
    def search(
        query: str,
        limit: int = None,
        albums_only=False,
        tracks_only=False,
    ):
        tracks_limit = Limit.tracks if tracks_only else 4
        albums_limit = Limit.albums if albums_only else limit
        artists_limit = limit

        # INFO: Individually search all stores as each type has a different scorer
        tracks = SearchTracks(query)(limit=tracks_limit) if not albums_only else []
        albums = SearchAlbums(query)(limit=albums_limit)
        artists = SearchArtists(query)(limit=artists_limit)

        # INFO: Combine all results and sort them by score
        all_results = artists + tracks + albums
        all_results = sorted(all_results, key=lambda x: int(x._score), reverse=True)

        # INFO: Get the top result. There is none when nothing matched — an empty
        # library before its first scan, or a query that fits nothing in it.
        top_result = all_results[0] if all_results else None
        top_tracks = []

        if not albums_only:
            own = TopResults.get_track_items(top_result, limit=tracks_limit)
            # Tracks whose TITLE holds the query as a word. They used to come
            # only after the top result's own tracks, so "saint" with an artist
            # "Saint …" on top listed four songs of that artist and not one
            # titled "Saint". The own tracks still lead when the top result IS
            # the query ("adele" -> Adele's songs).
            hits = [track for track in tracks if track._score >= WORD_MATCH]
            exact = top_result is not None and top_result._score >= EXACT_MATCH
            ordered = [*own, *hits] if exact else [*hits, *own]

            top_tracks = []
            found_tracks_set: set[str] = set()

            for track in [*ordered, *tracks]:
                if track.trackhash not in found_tracks_set:
                    found_tracks_set.add(track.trackhash)
                    top_tracks.append(track)

                if len(top_tracks) >= tracks_limit:
                    break

            top_tracks = serialize_tracks(top_tracks)

            if tracks_only:
                return top_tracks

        top_albums = TopResults.get_album_items(top_result, limit=albums_limit)

        # INFO: If there are not enough albums, fill with search results
        if len(top_albums) < albums_limit:
            found_albums_set = {album.albumhash for album in top_albums}

            for album in albums:
                if album.albumhash not in found_albums_set:
                    top_albums.append(album)

                    if len(top_albums) >= albums_limit:
                        break

        top_albums = serialize_albums(top_albums)

        if albums_only:
            return top_albums

        artists = serialize_for_cards(artists)

        if isinstance(top_result, Track):
            top_result = serialize_track(top_result)
            top_result["type"] = "track"

        if isinstance(top_result, Album):
            top_result = serialize_album(top_result)
            top_result["type"] = "album"

        if isinstance(top_result, Artist):
            top_result = serialize_for_card(top_result, include={"albumcount", "trackcount"})
            top_result["type"] = "artist"

        return {
            "top_result": top_result,
            "tracks": top_tracks,
            "artists": artists,
            "albums": top_albums,
        }
