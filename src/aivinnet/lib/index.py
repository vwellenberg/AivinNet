import gc
import logging
from time import time

from aivinnet.config import UserConfig
from aivinnet.lib import library_lock
from aivinnet.lib.mapstuff import (
    map_album_colors,
    map_artist_colors,
    map_favorites,
    map_scrobble_data,
)
from aivinnet.lib.populate import CordinateMedia
from aivinnet.lib.recipes.recents import RecentlyAdded
from aivinnet.lib.reference_migration import migrate_track_references_many
from aivinnet.lib.rescan_remap import hashes_by_path, remap_by_path
from aivinnet.lib.tagger import IndexTracks
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.threading import background

log = logging.getLogger(__name__)


@background
def index_everything():
    # After an apply or edit in progress, never alongside it (lib/library_lock.py).
    with library_lock.hold():
        _index_everything()


def _index_everything():
    # What the running server knows before the scan: the hash of every file.
    # A tag changed outside the app shows up as the same path with a new hash.
    before = hashes_by_path(TrackStore.trackhashmap)

    IndexTracks()

    key = str(time())
    TrackStore.load_all_tracks(key)
    # Before the play and favourite maps below read the references (#433).
    _carry_references(before)
    # Right behind the track store it points into, not after the albums and
    # artists: the folder view looked up the new hashes through the old map
    # for the whole rebuild (#391).
    FolderStore.load_filepaths()
    AlbumStore.load_albums(key)
    ArtistStore.load_artists(key)

    # NOTE: Rebuild recently added items on the homepage store
    RecentlyAdded()

    # map colors
    map_album_colors()
    map_artist_colors()

    map_scrobble_data()
    map_favorites()

    CordinateMedia(instance_key=str(time()))
    gc.collect()
    log.info("Indexing completed")


def _carry_references(before: dict[str, str]) -> None:
    """
    Move favourites, scrobbles and playlists from the hashes the scan replaced
    to the new ones. Only a file whose hash changed and whose old hash no other
    file still holds gets moved (lib/rescan_remap.py).
    """
    mapping = remap_by_path(before, hashes_by_path(TrackStore.trackhashmap))

    if not mapping:
        return

    migrate_track_references_many(mapping)
    log.info("Scan changed %d track hashes; their references were carried over", len(mapping))


def index_if_never_scanned() -> bool:
    """
    Scan once at startup when there are music folders but not a single track.

    Nothing else scans on its own: there is no startup or periodic scan, only
    the settings (adding a folder, "rescan"). So a folder written before the
    first start, which is exactly what `install.sh --music` does, was never read:
    the app came up with an empty library, and the folder had to be added again
    in the settings. A library that has tracks is left alone; its next scan is
    the user's call, as before.
    """
    if not UserConfig().rootDirs or TrackStore.get_flat_list():
        return False

    log.info("Music folders set but the library is empty: scanning once.")
    index_everything()
    return True
