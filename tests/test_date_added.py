"""When a file came into the library, for the rows that predate `track.added`.

Their only date is the mtime, and a tag edit may have moved it. A play before
the mtime proves the file was there earlier; nothing else in the database does.
"""

from types import SimpleNamespace

from aivinnet.lib.date_added import first_seen

LONG_AGO = 1_700_000_000
EDITED = 1_790_000_000


def _track(rowid: int, trackhash: str, last_mod: int):
    return SimpleNamespace(id=rowid, trackhash=trackhash, last_mod=last_mod)


def test_a_track_played_before_its_mtime_was_added_by_then():
    tracks = [_track(1, "retagged", EDITED)]

    assert first_seen(tracks, {"retagged": LONG_AGO}) == {1: LONG_AGO}


def test_a_play_after_the_mtime_says_nothing():
    """A new file, played since: it came in at its mtime."""
    tracks = [_track(1, "new", LONG_AGO)]

    assert first_seen(tracks, {"new": EDITED}) == {}


def test_a_track_never_played_keeps_its_mtime():
    tracks = [_track(1, "unplayed", EDITED)]

    assert first_seen(tracks, {"other": LONG_AGO}) == {}


def test_every_file_of_a_hash_takes_its_first_play():
    """An MP3 and a WAV with the same tags share the hash, and so its plays."""
    tracks = [_track(1, "twin", EDITED), _track(2, "twin", EDITED + 5)]

    assert first_seen(tracks, {"twin": LONG_AGO}) == {1: LONG_AGO, 2: LONG_AGO}
