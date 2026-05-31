"""
This module combines all API blueprints into a single Flask app instance.
"""

from swingmusic.api import (
    album,
    artist,
    auth,
    backup_and_restore,
    collections,
    colors,
    download,
    favorites,
    folder,
    getall,
    home,
    imgserver,
    lyrics,
    musicbrainz,
    playlist,
    plugins,
    scrobble,
    search,
    settings,
    stream,
)
from swingmusic.api.plugins import lyrics as lyrics_plugin
from swingmusic.api.plugins import mixes as mixes_plugin

__all__ = [
    "album",
    "artist",
    "auth",
    "backup_and_restore",
    "collections",
    "colors",
    "download",
    "favorites",
    "folder",
    "getall",
    "home",
    "imgserver",
    "lyrics",
    "lyrics_plugin",
    "mixes_plugin",
    "musicbrainz",
    "playlist",
    "plugins",
    "scrobble",
    "search",
    "settings",
    "stream",
]
