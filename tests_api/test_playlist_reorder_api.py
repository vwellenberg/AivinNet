"""Request-cycle tests for `PUT /playlists/<id>/reorder`.

This endpoint replaces the stored trackhash list wholesale, which is how a
single drag turned a 120-track playlist into a 44-track one: the client only
ever knows the page it has loaded, and orphan hashes are invisible to it
entirely, so its "complete" list is not complete (AivinNet#51,
`.claude/rules/playlist-writes.md`). The guard that now refuses anything but a
permutation was shipped without a test — these are it, and they run the real
HTTP cycle against the real PlaylistTable so the refusal is asserted where it
matters: 409 out, and the stored list byte-for-byte unchanged.
"""

import pytest
from sqlalchemy import select

from aivinnet.db.engine import DbEngine
from aivinnet.db.userdata import PlaylistTable

# A hash the library cannot resolve, i.e. one the client never sees and can
# therefore never send back. Every reorder must carry it along untouched.
ORPHAN = "0rphan00000000ff"


def _new_playlist(trackhashes: list[str], name: str = "Reorder spec") -> int:
    from aivinnet.utils.dates import create_new_date

    playlist_id = PlaylistTable.add_one(
        {
            "image": None,
            "last_updated": create_new_date(),
            "name": name,
            "settings": {"has_gif": False, "banner_pos": 50, "square_img": False, "pinned": False},
            "trackhashes": [],
            "extra": {},
        }
    )
    if trackhashes:
        PlaylistTable.append_to_playlist(playlist_id, trackhashes)

    return playlist_id


def _stored(playlist_id: int) -> list[str]:
    """Read the trackhash list straight from SQL, not through a helper."""
    with DbEngine.manager() as session:
        row = session.execute(select(PlaylistTable.trackhashes).where(PlaylistTable.id == playlist_id)).first()
    return list(row[0] or [])


@pytest.fixture()
def playlists_api(api_client):
    return api_client("aivinnet.api.playlist")


def _reorder(api, playlist_id: int, trackhashes: list[str]):
    return api.put(f"/playlists/{playlist_id}/reorder", json={"trackhashes": trackhashes})


def test_a_permutation_is_stored(playlists_api):
    playlist_id = _new_playlist(["a", "b", "c"])

    res = _reorder(playlists_api, playlist_id, ["c", "a", "b"])

    assert res.status_code == 200
    assert res.get_json() == {"msg": "Done"}
    assert _stored(playlist_id) == ["c", "a", "b"]


def test_a_shortened_list_is_refused_with_409_and_changes_nothing(playlists_api):
    """THE data-loss bug: a paginated client submits only what it has loaded."""
    playlist_id = _new_playlist(["a", "b", "c", "d"])

    res = _reorder(playlists_api, playlist_id, ["b", "a"])

    assert res.status_code == 409
    body = res.get_json()
    assert body["dropped"] == ["c", "d"]
    assert body["added"] == []
    assert _stored(playlist_id) == ["a", "b", "c", "d"]


def test_a_foreign_hash_is_refused_together_with_the_missing_one(playlists_api):
    """Both halves of the diff are reported, and neither is written."""
    playlist_id = _new_playlist(["a", "b", "c"])

    res = _reorder(playlists_api, playlist_id, ["c", "b", "intruder"])

    assert res.status_code == 409
    body = res.get_json()
    assert body["dropped"] == ["a"]
    assert body["added"] == ["intruder"]
    assert "not a permutation" in body["error"]
    assert _stored(playlist_id) == ["a", "b", "c"]


def test_an_orphan_survives_a_valid_permutation(playlists_api):
    """
    The orphan is part of the stored list, so a submission that omits it is
    *not* a permutation — the client must send it back to reorder at all, and
    once it does, the orphan keeps its place in the stored list.
    """
    playlist_id = _new_playlist(["a", ORPHAN, "b"])

    refused = _reorder(playlists_api, playlist_id, ["b", "a"])
    assert refused.status_code == 409
    assert refused.get_json()["dropped"] == [ORPHAN]

    accepted = _reorder(playlists_api, playlist_id, ["b", ORPHAN, "a"])
    assert accepted.status_code == 200
    assert _stored(playlist_id) == ["b", ORPHAN, "a"]


def test_an_unknown_playlist_is_404(playlists_api):
    assert _reorder(playlists_api, 4242, ["a"]).status_code == 404


def test_another_users_playlist_is_not_reorderable(playlists_api):
    playlist_id = _new_playlist(["a", "b"])

    playlists_api.userid = 2
    assert _reorder(playlists_api, playlist_id, ["b", "a"]).status_code == 404

    playlists_api.userid = 1
    assert _stored(playlist_id) == ["a", "b"]
