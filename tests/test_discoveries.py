"""What a user heard for the first time (#539): `lib/discoveries.py`."""

from aivinnet.lib.discoveries import first_heard_in, first_plays

TRACKS = {
    "t1": ("blood-sugar", ["rhcp"]),
    "t2": ("blood-sugar", ["rhcp"]),
    "t3": ("summer-hits", ["primus", "waits"]),
    "t4": ("untagged", ["unknown"]),
}


def resolve(trackhash):
    return TRACKS.get(trackhash)


def test_an_album_and_an_artist_are_first_heard_with_their_first_track():
    found = first_plays({"t1": 300, "t2": 100, "t3": 200}, resolve)

    assert found.albums == {"blood-sugar": 100, "summer-hits": 200}
    assert found.artists == {"rhcp": 100, "primus": 200, "waits": 200}


def test_a_track_no_longer_in_the_library_names_nothing():
    found = first_plays({"gone": 50, "t1": 100}, resolve)

    assert found.albums == {"blood-sugar": 100}


def test_nobody_is_no_artist_but_their_album_is_an_album():
    found = first_plays({"t4": 100}, resolve, skip_artist=lambda a: a == "unknown")

    assert found.artists == {}
    assert found.albums == {"untagged": 100}


def test_new_in_a_period_is_first_heard_in_it_latest_first():
    first = {"old": 10, "a": 100, "b": 150, "c": 200, "later": 999}

    assert first_heard_in(first, 100, 200) == ["c", "b", "a"]
    assert first_heard_in(first, 300, 400) == []
