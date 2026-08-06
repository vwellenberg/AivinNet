"""
PlaylistTable against a real SQLite database.

Everything that has gone wrong with playlists went wrong at this layer — a whole
list replaced with a partial one, a client index compared against a stored index,
a parallel `added_at` map left behind — and none of it was reachable by the pure
helper tests, which is why it shipped. These are round-trips: write through the
table's own API, read it back from SQL, assert what is actually stored.

They are also the safety net for the planned move to a `playlist_tracks` join
table: every one of them describes behaviour that must survive that change, so a
migration that breaks a guarantee fails here instead of in a user's library.
"""

import pytest
from sqlalchemy import select

from swingmusic.db.engine import DbEngine
from swingmusic.db.userdata import PlaylistTable
from swingmusic.lib.playlist_maintenance import TrackhashNotInPlaylist

# A hash the library cannot resolve. The API's read path only ever returns
# resolvable tracks, so a client can neither see this nor index around it —
# the condition under which both data-loss bugs happened.
ORPHAN = "0rphan00000000ff"


def _new_playlist(name: str = "Test") -> int:
    from swingmusic.utils.dates import create_new_date

    return PlaylistTable.add_one(
        {
            "image": None,
            "last_updated": create_new_date(),
            "name": name,
            "settings": {"has_gif": False, "banner_pos": 50, "square_img": False, "pinned": False},
            "trackhashes": [],
            "extra": {},
        }
    )


def _stored(playlist_id: int) -> list[str]:
    """Read the trackhash list straight from SQL, not through a helper."""
    with DbEngine.manager() as session:
        row = session.execute(select(PlaylistTable.trackhashes).where(PlaylistTable.id == playlist_id)).first()
    return list(row[0] or [])


def _extra(playlist_id: int) -> dict:
    with DbEngine.manager() as session:
        row = session.execute(select(PlaylistTable.extra).where(PlaylistTable.id == playlist_id)).first()
    return dict(row[0] or {})


@pytest.fixture()
def playlist(playlist_db):
    """An empty playlist, returned as its id."""
    return _new_playlist()


class TestAppend:
    def test_appends_in_order(self, playlist):
        PlaylistTable.append_to_playlist(playlist, ["a", "b", "c"])
        assert _stored(playlist) == ["a", "b", "c"]

    def test_appending_again_keeps_the_existing_order(self, playlist):
        PlaylistTable.append_to_playlist(playlist, ["a", "b"])
        PlaylistTable.append_to_playlist(playlist, ["c"])
        assert _stored(playlist) == ["a", "b", "c"]

    def test_a_duplicate_is_not_appended_twice(self, playlist):
        PlaylistTable.append_to_playlist(playlist, ["a", "b"])
        PlaylistTable.append_to_playlist(playlist, ["b"])
        assert _stored(playlist) == ["a", "b"]

    def test_records_added_at_for_new_hashes_only(self, playlist):
        PlaylistTable.append_to_playlist(playlist, ["a"])
        first = _extra(playlist)["added_at"]["a"]

        PlaylistTable.append_to_playlist(playlist, ["a", "b"])
        after = _extra(playlist)["added_at"]

        assert after["a"] == first, "re-appending an existing track reset its date added"
        assert "b" in after

    def test_an_orphan_already_stored_survives_an_append(self, playlist):
        PlaylistTable.append_to_playlist(playlist, [ORPHAN, "a"])
        PlaylistTable.append_to_playlist(playlist, ["b"])
        assert _stored(playlist) == [ORPHAN, "a", "b"]


class TestMove:
    @pytest.fixture()
    def filled(self, playlist):
        PlaylistTable.append_to_playlist(playlist, ["a", ORPHAN, "b", "c"])
        return playlist

    def test_moves_before_the_anchor(self, filled):
        PlaylistTable.move_in_playlist(filled, "a", "c")
        assert _stored(filled) == [ORPHAN, "b", "a", "c"]

    def test_a_null_anchor_moves_to_the_end(self, filled):
        PlaylistTable.move_in_playlist(filled, "a", None)
        assert _stored(filled) == [ORPHAN, "b", "c", "a"]

    def test_moving_to_the_very_top(self, filled):
        PlaylistTable.move_in_playlist(filled, "c", "a")
        assert _stored(filled) == ["c", "a", ORPHAN, "b"]

    def test_the_orphan_keeps_its_place(self, filled):
        PlaylistTable.move_in_playlist(filled, "b", "a")
        assert ORPHAN in _stored(filled)
        assert len(_stored(filled)) == 4

    def test_a_move_never_changes_the_track_count(self, filled):
        before = len(_stored(filled))
        PlaylistTable.move_in_playlist(filled, "c", "b")
        assert len(_stored(filled)) == before

    def test_added_at_is_untouched_by_a_move(self, filled):
        before = _extra(filled).get("added_at")
        PlaylistTable.move_in_playlist(filled, "a", "c")
        assert _extra(filled).get("added_at") == before

    def test_an_unknown_trackhash_raises_and_writes_nothing(self, filled):
        before = _stored(filled)
        with pytest.raises(TrackhashNotInPlaylist):
            PlaylistTable.move_in_playlist(filled, "nope", "a")
        assert _stored(filled) == before

    def test_an_unknown_anchor_raises_and_writes_nothing(self, filled):
        before = _stored(filled)
        with pytest.raises(TrackhashNotInPlaylist):
            PlaylistTable.move_in_playlist(filled, "a", "nope")
        assert _stored(filled) == before


class TestRemove:
    @pytest.fixture()
    def filled(self, playlist):
        PlaylistTable.append_to_playlist(playlist, [ORPHAN, "a", "b", "c"])
        return playlist

    def test_removes_the_requested_track(self, filled):
        PlaylistTable.remove_from_playlist(filled, [{"trackhash": "b", "index": 2}])
        assert _stored(filled) == [ORPHAN, "a", "c"]

    def test_removes_when_the_client_index_is_shifted_by_an_orphan(self, filled):
        # THE BUG: the client counts resolved tracks, so it sends index 1 for "b"
        # while its stored index is 2. The old guard compared the two and made the
        # removal a silent no-op that still answered 200/"Done".
        PlaylistTable.remove_from_playlist(filled, [{"trackhash": "b", "index": 1}])
        assert _stored(filled) == [ORPHAN, "a", "c"]

    def test_removing_several_at_once(self, filled):
        PlaylistTable.remove_from_playlist(filled, [{"trackhash": "a", "index": 0}, {"trackhash": "c", "index": 2}])
        assert _stored(filled) == [ORPHAN, "b"]

    def test_the_orphan_is_not_collateral(self, filled):
        PlaylistTable.remove_from_playlist(filled, [{"trackhash": "a", "index": 0}])
        assert ORPHAN in _stored(filled)

    def test_added_at_loses_the_removed_hash(self, filled):
        PlaylistTable.remove_from_playlist(filled, [{"trackhash": "b", "index": 1}])
        assert "b" not in _extra(filled).get("added_at", {})

    def test_removing_an_unknown_hash_changes_nothing(self, filled):
        before = _stored(filled)
        PlaylistTable.remove_from_playlist(filled, [{"trackhash": "nope", "index": 0}])
        assert _stored(filled) == before


class TestPagination:
    """
    The read path slices the stored list. A join table has to answer the same
    windows with ORDER BY/LIMIT, so the expected windows are pinned here.
    """

    @pytest.fixture()
    def long(self, playlist):
        PlaylistTable.append_to_playlist(playlist, [f"h{i}" for i in range(120)])
        return playlist

    def test_a_page_is_a_window_into_the_stored_order(self, long):
        stored = _stored(long)
        assert stored[0:38] == [f"h{i}" for i in range(38)]
        assert stored[38:76] == [f"h{i}" for i in range(38, 76)]

    def test_the_count_is_the_number_of_stored_hashes(self, long):
        assert len(_stored(long)) == 120

    def test_a_move_inside_the_first_page_does_not_disturb_later_pages(self, long):
        PlaylistTable.move_in_playlist(long, "h0", "h5")
        assert _stored(long)[38:] == [f"h{i}" for i in range(38, 120)]
        assert len(_stored(long)) == 120


class TestUserIsolation:
    def test_another_users_playlist_is_not_readable(self, playlist_db):
        _, userid = playlist_db
        mine = _new_playlist("Mine")
        PlaylistTable.append_to_playlist(mine, ["a"])

        userid.return_value = 2
        assert PlaylistTable.get_by_id(mine) is None

        userid.return_value = 1
        assert PlaylistTable.get_by_id(mine) is not None

    def test_another_user_cannot_move_tracks_in_it(self, playlist_db):
        _, userid = playlist_db
        mine = _new_playlist("Mine")
        PlaylistTable.append_to_playlist(mine, ["a", "b", "c"])
        before = _stored(mine)

        userid.return_value = 2
        with pytest.raises(TrackhashNotInPlaylist):
            PlaylistTable.move_in_playlist(mine, "a", "c")

        userid.return_value = 1
        assert _stored(mine) == before
