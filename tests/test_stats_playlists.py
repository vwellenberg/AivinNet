"""Unit tests for get_playlists_in_period.

Playlists, unlike albums/artists, are credited only for plays started from
them (scrobble source ``pl:<id>``). This verifies the grouping, the source
filter and the playduration-descending sort.
"""

import sys
from unittest.mock import MagicMock

# Mock heavy / unavailable deps just long enough to import the stats module (the
# fast CI lane installs only a handful of packages). We track which mocks we add
# and remove them again right after the import so we don't shadow real modules
# for test files collected after this one (e.g. test_track_store_remove imports
# the *real* swingmusic.store.tracks).
_added = []
for _mod in [
    "sqlalchemy",
    "sqlalchemy.orm",
    "flask_jwt_extended",
    "flask",
    "swingmusic.db.userdata",
    "swingmusic.db.libdata",
    "swingmusic.models.album",
    "swingmusic.models.track",
    "swingmusic.models.stats",
    "swingmusic.store.albums",
    "swingmusic.store.tracks",
    "swingmusic.utils.auth",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()
        _added.append(_mod)

from swingmusic.utils import stats  # noqa: E402

# stats has bound its references; drop the temporary mocks so they don't leak.
for _mod in _added:
    sys.modules.pop(_mod, None)


class _Scrobble:
    """Minimal TrackLog stand-in (only the fields the function reads)."""

    def __init__(self, type: str, type_src, duration: int):
        self.type = type
        self.type_src = type_src
        self.duration = duration


def _run(scrobbles):
    stats.ScrobbleTable.get_all_in_period = lambda *args, **kwargs: iter(scrobbles)
    return stats.get_playlists_in_period(0, 100)


def test_groups_and_sums_per_playlist():
    result = _run(
        [
            _Scrobble("playlist", "1", 100),
            _Scrobble("playlist", "1", 50),
            _Scrobble("playlist", "2", 30),
        ]
    )

    by_id = {p["playlistid"]: p for p in result}
    assert by_id["1"] == {"playlistid": "1", "playcount": 2, "playduration": 150}
    assert by_id["2"] == {"playlistid": "2", "playcount": 1, "playduration": 30}


def test_ignores_non_playlist_sources():
    result = _run(
        [
            _Scrobble("album", "abc", 100),
            _Scrobble("artist", "def", 100),
            _Scrobble("favorite", None, 100),
            _Scrobble("playlist", "7", 40),
        ]
    )

    assert [p["playlistid"] for p in result] == ["7"]


def test_sorted_by_playduration_desc():
    result = _run(
        [
            _Scrobble("playlist", "low", 10),
            _Scrobble("playlist", "high", 500),
            _Scrobble("playlist", "mid", 100),
        ]
    )

    assert [p["playlistid"] for p in result] == ["high", "mid", "low"]


def test_empty_period_returns_empty_list():
    assert _run([]) == []
