"""
Rendering helpers for stored collection ("page") items.

Only the READ half is left: the write helpers (`validate_page_items`,
`remove_page_items`) had exactly one caller, the `/collections` blueprint, and
went with it. Existing collection rows are still rendered on the homepage
(`store/homepage.py`) and still travel in backups, which is why this file and
`CollectionTable` stay.
"""

from typing import Any

from swingmusic.serializers.album import serialize_for_card
from swingmusic.serializers.artist import serialize_for_card as serialize_artist
from swingmusic.store.albums import AlbumStore
from swingmusic.store.artists import ArtistStore


def recover_page_items(items: list[dict[str, str]], for_homepage: bool = False):
    """
    Recover the items in a page.
    """
    recovered: list[dict[str, Any]] = []

    for item in items:
        if item["type"] == "album":
            album = AlbumStore.albummap.get(item["hash"])

            if album is not None:
                item = serialize_for_card(album.album)

                if for_homepage:
                    del item["type"]
                    item = {"item": item, "type": "album"}

                recovered.append(item)
        elif item["type"] == "artist":
            artist = ArtistStore.artistmap.get(item["hash"])

            if artist is not None:
                item = serialize_artist(artist.artist)

                if for_homepage:
                    del item["type"]
                    item = {"item": item, "type": "artist"}

                recovered.append(item)

    recovered.reverse()
    return recovered
