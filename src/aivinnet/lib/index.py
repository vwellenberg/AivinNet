import gc
import logging
from time import time

from aivinnet.config import UserConfig
from aivinnet.lib.mapstuff import (
    map_album_colors,
    map_artist_colors,
    map_favorites,
    map_scrobble_data,
)
from aivinnet.lib.populate import CordinateMedia
from aivinnet.lib.recipes.recents import RecentlyAdded
from aivinnet.lib.tagger import IndexTracks
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.threading import background

log = logging.getLogger(__name__)


@background
def index_everything():
    IndexTracks()

    key = str(time())
    TrackStore.load_all_tracks(key)
    AlbumStore.load_albums(key)
    ArtistStore.load_artists(key)
    FolderStore.load_filepaths()

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
