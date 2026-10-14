"""Which old hashes the name cleanup carries over, and which it must leave (pure part).

The server takes a track number off a title and a role off an artist when it
loads the library (`utils/parsers.py`), so a track can have a new trackhash
and an artist a new artisthash without any file changing. `lib/name_cleanup.py`
moves the references; this is the decision what moves, the same rules a rescan
follows (`rescan_remap.remap_by_path`). The database part is tested against the
real tables in `tests_api/test_name_cleanup.py`.
"""

from types import SimpleNamespace

from aivinnet.lib.name_cleanup import legacy_artist_mapping, legacy_track_mapping


def _track(path, new, legacy="", artists=(), legacy_artists=()):
    return SimpleNamespace(
        filepath=path,
        trackhash=new,
        _legacyhash=legacy,
        artists=[{"artisthash": a} for a in artists],
        albumartists=[],
        _legacy_artisthashes=tuple(legacy_artists),
    )


def test_a_renamed_track_moves_from_its_old_hash():
    assert legacy_track_mapping([_track("/a.mp3", "new1", "old1")]) == {"old1": "new1"}


def test_a_track_the_cleanup_left_alone_moves_nothing():
    assert legacy_track_mapping([_track("/a.mp3", "same")]) == {}


def test_an_old_hash_another_track_still_carries_stays():
    # Two files shared the hash; one lost its number, the other kept it.
    tracks = [_track("/a.mp3", "new1", "shared"), _track("/b.mp3", "shared")]
    assert legacy_track_mapping(tracks) == {}


def test_an_old_hash_split_over_two_new_ones_follows_neither():
    tracks = [_track("/a.mp3", "new1", "old"), _track("/b.mp3", "new2", "old")]
    assert legacy_track_mapping(tracks) == {}


def test_a_renamed_artist_moves_to_its_cleaned_name():
    tracks = [_track("/a.mp3", "t", artists=["adam"], legacy_artists=[("composed-adam", "adam")])]
    assert legacy_artist_mapping(tracks) == {"composed-adam": "adam"}


def test_an_artist_old_name_that_some_track_still_carries_stays():
    tracks = [
        _track("/a.mp3", "t1", artists=["adam"], legacy_artists=[("composed-adam", "adam")]),
        _track("/b.mp3", "t2", artists=["composed-adam"]),
    ]
    assert legacy_artist_mapping(tracks) == {}


def _body(path, start):
    from pathlib import Path

    # From the repo root, not the working directory pytest happens to run in.
    source = (Path(__file__).parents[1] / path).read_text(encoding="utf-8")
    return source[source.index(start) :]


def test_both_load_paths_carry_the_cleaned_names_before_the_references_are_mapped():
    # The start (setup.load_into_mem) and every rescan (index._index_everything,
    # which a backup restore ends in): right after the track store is loaded,
    # before favourites and plays are mapped onto it.
    for path, start in (
        ("src/aivinnet/setup/__init__.py", "def load_into_mem"),
        ("src/aivinnet/lib/index.py", "def _index_everything"),
    ):
        body = _body(path, start)
        loaded = body.index("TrackStore.load_all_tracks(")
        carried = body.index("carry_cleaned_names()")
        mapped = min(body.index("map_favorites()"), body.index("map_scrobble_data()"))
        assert loaded < carried < mapped, path
