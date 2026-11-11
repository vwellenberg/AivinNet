"""The in-RAM carry of personal ratings across a retag (#777).

A retag rebuilds the track object in the store. `track_edit._carry_over` copies the
state the store derives from other tables (`_DERIVED_STATE`), so the rebuilt track
keeps the ratings of the old one until the next restart. Without "rated_by" in that
list the rating vanished from the screen and from the smart playlists until a
restart, while the database row had already moved.

A full retag needs a real audio file on disk, so this pins the seam the retag
uses: the real `_carry_over` over two real `Track` objects, and the real
`_DERIVED_STATE` list.
"""

from datetime import UTC, datetime

from aivinnet.config import UserConfig
from aivinnet.lib import track_edit
from aivinnet.models.track import Track

NOW = int(datetime(2026, 6, 1, tzinfo=UTC).timestamp())


def _track(trackhash: str) -> Track:
    return Track(
        id=1,
        album="Album",
        albumartists="Artist",
        albumhash="alb",
        artists="Artist",
        bitrate=320,
        copyright="",
        date=NOW,
        disc=1,
        duration=200,
        filepath="/music/Artist/a.flac",
        folder="/music/Artist",
        genres="Rock",
        last_mod=NOW,
        title="Title",
        track=1,
        trackhash=trackhash,
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
        added=NOW,
    )


def test_the_derived_state_list_carries_ratings():
    assert "rated_by" in track_edit._DERIVED_STATE


def test_a_retagged_track_keeps_its_ratings_in_ram():
    old = _track("oldhash0000000000")
    old.set_rating(1, 4)
    old.set_rating(2, 1)
    new = _track("newhash0000000000")

    track_edit._carry_over(old, new)

    assert new.rated_by == {1: 4, 2: 1}
    assert new.rating_of(1) == 4


def test_the_carried_map_is_a_copy_not_shared_with_the_old_track():
    old = _track("oldhash0000000000")
    old.set_rating(1, 4)
    new = _track("newhash0000000000")

    track_edit._carry_over(old, new)
    new.set_rating(1, 2)

    assert old.rating_of(1) == 4
    assert new.rating_of(1) == 2


def test_an_unrated_old_track_carries_no_rating():
    old = _track("oldhash0000000000")
    new = _track("newhash0000000000")

    track_edit._carry_over(old, new)

    assert new.rated_by == {}
