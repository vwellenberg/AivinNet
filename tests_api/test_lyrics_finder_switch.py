"""
Off means nothing goes to Musixmatch — enforced by the server, not the client.

Regression: the client decided on its own whether to look lyrics up, from its
copy of the plugin's sub-options (`auto_download`). Those are loaded whether the
plugin is on or not, so a plugin switched off with `auto_download` still stored
as on would have sent title and artist anyway — and `/plugins/lyrics/search`
never asked whether the plugin was active.
"""

import pytest

BODY = {
    "trackhash": "abc123def456",
    "title": "Song",
    "artist": "Artist",
    "album": "Album",
    "filepath": "/music/song.mp3",
}


@pytest.fixture()
def finder_calls(monkeypatch):
    """Record what would have gone to Musixmatch instead of sending it."""
    import aivinnet.api.plugins.lyrics as lyrics_api

    calls = []

    class _Finder:
        def search_lyrics_by_title_and_artist(self, title, artist):
            calls.append((title, artist))
            return []

    monkeypatch.setattr(lyrics_api, "Lyrics", _Finder)
    return calls


def _plugin_row(active: bool):
    from aivinnet.db.userdata import PluginTable

    PluginTable.insert_one(
        {
            "name": "lyrics_finder",
            "active": active,
            "settings": {"auto_download": True, "overide_unsynced": False},
            "extra": {},
        }
    )


def test_switched_off_nothing_is_sent(api_client, finder_calls):
    api = api_client("aivinnet.api.plugins.lyrics")
    _plugin_row(active=False)

    res = api.post("/plugins/lyrics/search", json=BODY)

    assert res.status_code == 403
    assert finder_calls == []


def test_switched_on_the_lookup_runs(api_client, finder_calls):
    api = api_client("aivinnet.api.plugins.lyrics")
    _plugin_row(active=True)

    res = api.post("/plugins/lyrics/search", json=BODY)

    assert res.status_code == 200
    assert finder_calls == [("Song", "Artist")]
