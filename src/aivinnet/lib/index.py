import gc
import logging
from time import time

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
