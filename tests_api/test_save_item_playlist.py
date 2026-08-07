"""Regression: "Album/Artist -> New playlist" 500'd on every request.

The upstream refactor merge (e7706065) turned the Paths fields into pathlib
properties, but save_item_as_playlist kept calling `lg_thumb_path()` and
concatenating `base_path + "/"`. Both raise TypeError — the album branch on the
call, the artist branch on the concat — so every save-item for those itemtypes
returned HTTP 500. Worse, the crash happened AFTER insert_playlist, so each
attempt left an empty playlist row behind and a retry answered 409
"Playlist already exists".

These tests run the real handler against the real PlaylistTable (playlist_db
fixture); only the store lookup is patched because tests never see a real
library. Red before the fix (TypeError), green after.
"""

from unittest.mock import patch


def _run_save_item(itemtype: str, patched_lookup: str, playlist_name: str):
    from aivinnet.api import playlist as pl

    body = pl.SavePlaylistAsItemBody(
        itemtype=itemtype,
        itemhash="93bbb731deae118c",
        playlist_name=playlist_name,
    )

    with patch.object(pl, patched_lookup, return_value=["deadbeefdeadbeef"]):
        return pl.save_item_as_playlist(body)


def test_save_album_as_playlist_returns_201(playlist_db):
    table, _ = playlist_db

    response, status = _run_save_item("album", "get_album_trackhashes", "album-pl")

    assert status == 201
    assert response["playlist"].name == "album-pl"
    assert response["playlist"].count == 1

    # The row really exists and carries the track.
    saved = next(p for p in table.get_all() if p.name == "album-pl")
    assert saved.trackhashes == ["deadbeefdeadbeef"]


def test_save_artist_as_playlist_returns_201(playlist_db):
    table, _ = playlist_db

    response, status = _run_save_item("artist", "get_artist_trackhashes", "artist-pl")

    assert status == 201
    assert response["playlist"].name == "artist-pl"

    saved = next(p for p in table.get_all() if p.name == "artist-pl")
    assert saved.trackhashes == ["deadbeefdeadbeef"]
