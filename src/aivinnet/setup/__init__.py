"""
Prepares the server for use.
"""

import uuid
from dataclasses import asdict
from time import time

from aivinnet.config import UserConfig
from aivinnet.lib.mapstuff import (
    map_album_colors,
    map_artist_colors,
    map_favorites,
    map_scrobble_data,
)
from aivinnet.lib.placeholder_artists import purge_placeholder_artist_images
from aivinnet.settings import Paths
from aivinnet.setup.sqlite import run_migrations, setup_sqlite
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.generators import get_random_str


def run_setup():
    """
    Creates the config directory, runs migrations, and loads settings.
    """

    # setup config file
    config = UserConfig()
    config.setup_config_file()

    if not config.serverId:
        config.serverId = str(uuid.uuid4())
        config.write_to_file(asdict(config))

    setup_sqlite()
    run_migrations()

    # On every start, not only on a scan: the stale face dates from a scan
    # with online metadata on, and nothing but a start is guaranteed to come.
    paths = Paths()
    purge_placeholder_artist_images([paths.sm_artist_img_path, paths.md_artist_img_path, paths.lg_artist_img_path])


def load_into_mem():
    """
    Load all tracks, albums, and artists into memory.
    """
    # INFO: Load all tracks, albums, and artists data into memory
    key = str(time())
    TrackStore.load_all_tracks(get_random_str())
    AlbumStore.load_albums(key)
    ArtistStore.load_artists(key)
    FolderStore.load_filepaths()

    map_scrobble_data()
    map_favorites()
    map_artist_colors()
    map_album_colors()
