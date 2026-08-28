"""Deleting a playlist must reach only the caller's own.

`PlaylistTable` scoped nine of its ten mutators to `userid` and inherited the
tenth — the destructive one — from `Base`, which matches on the primary key
alone. Playlist ids come from one sequence shared by every account, so any
logged-in user could walk ids and delete other people's playlists, receiving
`200 {"msg": "Done"}` every time.

Both halves are pinned: the table method, and the route on top of it. The route
matters separately because a scoped DELETE that matches nothing looks exactly
like a successful one unless the handler checks first.

⚠️ These assert EXACT status codes. flask_openapi3 validates the request model
before the view runs, so a malformed id answers 422 without the handler ever
executing — a test written as "not 200" would pass against a wide-open server.
"""

import pytest

MINE = 1
THEIRS = 2


@pytest.fixture()
def scene(api_client):
    """
    One playlist per owner, and a handle acting as user 1.

    Only `api_client` is used, never `playlist_db` alongside it: both patch
    `get_current_userid`, and the second patch would shadow the handle's own
    actor switch.
    """
    from aivinnet.db.userdata import PlaylistTable

    handle = api_client("aivinnet.api.playlist")

    PlaylistTable.add_one({"name": "mine", "userid": MINE, "settings": {}, "last_updated": 0})
    PlaylistTable.add_one({"name": "theirs", "userid": THEIRS, "settings": {}, "last_updated": 0})

    handle.userid = THEIRS
    theirs = next(p for p in PlaylistTable.get_all() if p.name == "theirs")

    handle.userid = MINE
    mine = next(p for p in PlaylistTable.get_all() if p.name == "mine")

    return handle, PlaylistTable, mine.id, theirs.id


def _still_there(table, handle, playlist_id, owner):
    handle.userid = owner
    present = table.get_by_id(playlist_id) is not None
    handle.userid = MINE
    return present


class TestTable:
    def test_deletes_your_own(self, scene):
        _handle, table, mine, _ = scene

        table.remove_one(mine)

        assert table.get_by_id(mine) is None

    def test_leaves_someone_elses_alone(self, scene):
        handle, table, _, theirs = scene

        table.remove_one(theirs)  # acting as user 1

        assert _still_there(table, handle, theirs, THEIRS), "another user's playlist was deleted"

    def test_walking_every_id_destroys_nothing_of_theirs(self, scene):
        """The actual attack: no knowledge needed, just count upwards."""
        handle, table, _, theirs = scene

        for candidate in range(1, theirs + 5):
            table.remove_one(candidate)

        assert _still_there(table, handle, theirs, THEIRS)


class TestRoute:
    def test_deleting_your_own_still_works(self, scene):
        handle, table, mine, _ = scene

        res = handle.delete(f"/playlists/{mine}/delete")

        assert res.status_code == 200
        assert table.get_by_id(mine) is None

    def test_someone_elses_playlist_is_404_not_a_cheerful_200(self, scene):
        handle, table, _, theirs = scene

        res = handle.delete(f"/playlists/{theirs}/delete")

        assert res.status_code == 404
        assert _still_there(table, handle, theirs, THEIRS)

    def test_an_id_that_exists_nowhere_is_also_404(self, scene):
        handle, _, _, _ = scene

        res = handle.delete("/playlists/999999/delete")

        assert res.status_code == 404
