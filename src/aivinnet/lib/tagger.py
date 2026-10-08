import os
from functools import partial
from logging import getLogger
from multiprocessing import Pool, cpu_count

from aivinnet import settings
from aivinnet.config import UserConfig
from aivinnet.db.libdata import TrackTable
from aivinnet.lib.taglib import extract_thumb, get_tags
from aivinnet.models.album import Album
from aivinnet.models.artist import Artist
from aivinnet.models.track import Track
from aivinnet.store.tracks import TrackStore
from aivinnet.utils import flatten
from aivinnet.utils.filesystem import ScanScope, is_hidden_path, run_fast_scandir
from aivinnet.utils.parsers import get_base_album_title
from aivinnet.utils.progressbar import tqdm
from aivinnet.utils.remove_duplicates import remove_duplicates

log = getLogger(__name__)


def parse_file_tags(file: str, config: UserConfig) -> dict | None:
    """Worker function to process individual files"""
    try:
        return get_tags(file, config=config)
    except Exception as e:
        log.warning(f"Failed to process file {file}: {e}")
        return None


class IndexTracks:
    def __init__(self) -> None:
        """
        Indexes all tracks in the database.

        An instance key is used to prevent multiple instances of the
        same class from running at the same time.
        """
        dirs_to_scan = UserConfig().rootDirs

        if len(dirs_to_scan) == 0:
            log.warning("The root directory is not configured. " + "Open the app in your webbrowser to configure.")
            return

        try:
            if dirs_to_scan[0] == "$home":
                dirs_to_scan = [settings.Paths().USER_HOME_DIR.as_posix()]
        except IndexError:
            pass

        exclude = UserConfig().excludeDirs
        unreadable: set[str] = set()
        found = {
            _dir: run_fast_scandir(_dir, full=True, exclude=exclude, unreadable=unreadable)[1] for _dir in dirs_to_scan
        }
        files = set().union(*found.values())

        unmodified, modified_tracks = self.filter_modded(ScanScope.from_scan(found, exclude, unreadable))
        untagged = files - unmodified

        self.tag_untagged(untagged)
        self.extract_thumb_with_overwrite(modified_tracks)

    @staticmethod
    def extract_thumb_with_overwrite(tracks: list[dict[str, str]]):
        """
        Extracts the thumbnail from a list of filepaths,
        overwriting the existing thumbnail if it exists,
        for modified files.
        """
        for track in tracks:
            try:
                extract_thumb(track["filepath"], track["albumhash"] + ".webp", overwrite=True, paths=settings.Paths())
            except FileNotFoundError:
                continue

    @staticmethod
    def filter_modded(scope: ScanScope):
        """
        Removes tracks from the database that have been modified
        since they were indexed, or that are no longer in the library.

        A row under a music folder the scan could not reach is left alone:
        an offline NAS or an empty mount point is not a deleted library (#391).

        Returns a tuple of unmodified paths and modified tracks.
        Unmodified paths are indexed and the modified tracks are

        """

        unmodified_paths = set()
        modified_tracks: list[dict[str, str]] = []

        to_remove = set()
        kept_unjudged = 0

        for track in TrackTable.get_all():
            # Drop entries the scanner would now filter out (missing files, but
            # also hidden dot-files and macOS AppleDouble ``._*`` sidecars that
            # still exist on disk and therefore never trip the mtime check).
            if is_hidden_path(track.filepath):
                to_remove.add(track.filepath)
                continue

            verdict = scope.verdict(track.filepath)
            if verdict == "drop":
                to_remove.add(track.filepath)
                continue
            if verdict == "keep":
                kept_unjudged += 1
                unmodified_paths.add(track.filepath)
                continue

            try:
                if track.last_mod == round(os.path.getmtime(track.filepath)):
                    unmodified_paths.add(track.filepath)
                    continue
            except (FileNotFoundError, OSError) as e:
                log.warning(e)  # REVIEW More informations = good
                to_remove.add(track.filepath)

            modified_tracks.append(
                {
                    "filepath": track.filepath,
                    "albumhash": track.albumhash,
                }
            )

        if kept_unjudged:
            log.warning(
                "Kept %d tracks unchecked while %s did not answer (offline, empty or unreadable?)",
                kept_unjudged,
                ", ".join(scope.unanswered),
            )

        to_remove = to_remove.union(set(t["filepath"] for t in modified_tracks))
        TrackTable.remove_tracks_by_filepaths(to_remove)

        return unmodified_paths, modified_tracks

    def tag_untagged(self, files: set[str]):
        config = UserConfig()

        # Create process pool with worker function
        with Pool(processes=max(1, cpu_count() // 2)) as pool:
            worker = partial(parse_file_tags, config=config)

            # Process files and track progress
            results = []
            for result in tqdm(
                pool.imap_unordered(worker, files),
                total=len(files),
                desc="Reading files",
            ):
                if result is not None:
                    results.append(result)

        # Bulk insert results
        # The folder store is NOT touched here: it is read by request threads
        # while this runs, and `load_filepaths()` rebuilds it after the scan.
        for tags in results:
            TrackTable.insert_one(tags)

        print(f"{len(results)} new files indexed")
        print("Done")


#
# Create functions
#


def create_albums(_trackhashes: list[str] = []) -> list[tuple[Album, set[str]]]:
    """
    Creates album objects using the indexed tracks. Takes in an optional
    list of trackhashes to create the albums from. If no list is provided,
    all tracks are used.

    The trackhashes are passed when creating albums from the watchdogg module.

    Returns a list of tuples containing the album and the trackhashes in the album.
    ie:

    >>> list[tuple[Album, set[str]]]
    """
    albums = dict()

    if _trackhashes:
        all_tracks: list[Track] = TrackStore.get_tracks_by_trackhashes(_trackhashes)
    else:
        all_tracks: list[Track] = TrackStore.get_flat_list()

    all_tracks = remove_duplicates(all_tracks)

    for track in all_tracks:
        if track.albumhash not in albums:
            albums[track.albumhash] = {
                "albumartists": track.albumartists,
                "artisthashes": [a["artisthash"] for a in track.albumartists],
                "albumhash": track.albumhash,
                "base_title": None,
                "color": None,
                "created_date": track.last_mod,
                "date": track.date,
                "duration": track.duration,
                "genres": [*track.genres] if track.genres else [],
                "og_title": track.og_album,
                "lastplayed": track.lastplayed,
                "playcount": track.playcount,
                "playduration": track.playduration,
                "title": track.album,
                "tracks": {track.trackhash},
                "pathhash": track.pathhash,
                "extra": {},
            }
        else:
            album = albums[track.albumhash]
            album["tracks"].add(track.trackhash)
            album["playcount"] += track.playcount
            album["playduration"] += track.playduration
            album["lastplayed"] = max(album["lastplayed"], track.lastplayed)
            album["duration"] += track.duration
            album["date"] = min(album["date"], track.date)
            album["created_date"] = min(album["created_date"], track.last_mod)

            if track.genres:
                album["genres"].extend(track.genres)

    for album in albums.values():
        genres = []
        for genre in album["genres"]:
            if genre not in genres:
                genres.append(genre)

        album["genres"] = genres
        album["genrehashes"] = " ".join([g["genrehash"] for g in genres])
        album["base_title"], _ = get_base_album_title(album["og_title"])

        del genres
        trackhashes = album.pop("tracks")
        album["trackcount"] = len(trackhashes)

        albums[album["albumhash"]] = (Album(**album), trackhashes)

    return list(albums.values())


def create_artists(artisthashes: list[str]) -> list[tuple[Artist, set[str], set[str]]]:
    """
    Creates artist objects using the indexed tracks. Takes in an optional
    list of artisthashes to create the artists from. If no list is provided,
    all tracks are used.

    Returns a list of tuples containing the artist, the trackhashes for the artist
    and the albumhashes for the artist.
    ie:

    >>> list[tuple[Artist, set[str], set[str]]]
    """

    all_tracks: list[Track] = TrackStore.get_flat_list()

    if artisthashes:
        # Performer OR album artist, as the full build counts them. By
        # performer alone, rebuilding one artist after an edit dropped the
        # albums where they are only the album artist (#391).
        wanted = set(artisthashes)
        all_tracks = [
            t
            for t in all_tracks
            if wanted.intersection(t.artisthashes) or any(a["artisthash"] in wanted for a in t.albumartists)
        ]

    all_tracks = remove_duplicates(all_tracks)
    artists = dict()

    for track in all_tracks:
        this_artists = [*track.artists]
        performers = {a["artisthash"] for a in track.artists}

        for a in track.albumartists:
            if a["artisthash"] not in performers:
                # A copy: these are the track's own dicts, and the key went
                # out to the client with every album artist (#391).
                this_artists.append({**a, "in_track": False})

        for thisartist in this_artists:
            if thisartist["artisthash"] not in artists:
                artists[thisartist["artisthash"]] = {
                    "albumcount": None,
                    "albums": {track.albumhash},
                    "artisthash": thisartist["artisthash"],
                    "created_date": track.last_mod,
                    "date": track.date,
                    "duration": track.duration,
                    # A copy, like create_albums: extended below, the
                    # track's own list gave every artist of it every other
                    # artist's genres (#391).
                    "genres": [*track.genres] if track.genres else [],
                    "name": None,
                    "names": {thisartist["name"]},
                    "lastplayed": track.lastplayed,
                    "playcount": track.playcount,
                    "playduration": track.playduration,
                    "trackcount": None,
                    "tracks": ({track.trackhash} if thisartist.get("in_track", True) else set()),
                    "extra": {},
                }
            else:
                artist: dict = artists[thisartist["artisthash"]]
                artist["duration"] += track.duration
                artist["playcount"] += track.playcount
                artist["playduration"] += track.playduration
                artist["albums"].add(track.albumhash)
                artist["date"] = min(artist["date"], track.date)
                artist["lastplayed"] = max(artist["lastplayed"], track.lastplayed)
                artist["created_date"] = min(artist["created_date"], track.last_mod)
                artist["names"].add(thisartist["name"])

                artist.setdefault("albums", set())

                if thisartist.get("in_track", True):
                    artist["tracks"].add(track.trackhash)

                if track.genres:
                    artist["genres"].extend(track.genres)

    for artist in artists.values():
        artist["albumcount"] = len(artist["albums"])
        artist["trackcount"] = len(artist["tracks"])

        genres = []

        for genre in artist["genres"]:
            if genre not in genres:
                genres.append(genre)

        artist["genres"] = genres
        artist["genrehashes"] = " ".join([g["genrehash"] for g in genres])
        artist["name"] = sorted(artist["names"])[0]

        # INFO: Delete temporary keys
        del artist["names"]

        tracks = artist.pop("tracks")
        albums = artist.pop("albums")

        # INFO: Delete local variables
        del genres

        artists[artist["artisthash"]] = (Artist(**artist), tracks, albums)

    return list(artists.values())
