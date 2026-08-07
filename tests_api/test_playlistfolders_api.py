"""Request-cycle tests for `POST /playlistfolders/move`.

All six `/playlistfolders` endpoints shipped without a test, and the move
handler had the same shape as the save-item crash (AivinNet#82): it performed
its side effect — pulling the playlist out of every folder — and only then
checked whether the target it was moving *to* exists. A 404 therefore left the
playlist orphaned at the top level, i.e. the failure path silently destroyed the
assignment it was supposed to leave alone (AivinNet-Client#436).
"""

import pytest


@pytest.fixture()
def folders_api(api_client):
    return api_client("aivinnet.api.playlistfolders")


def _create_folder(api, name: str) -> int:
    res = api.post("/playlistfolders", json={"name": name})
    assert res.status_code == 201
    return res.get_json()["id"]


def _items(api, folder_id: int) -> list[int]:
    """Read the folder back through the list endpoint, not the move response."""
    folders = api.get("/playlistfolders").get_json()
    return next(f for f in folders if f["id"] == folder_id)["items"]


def _move(api, playlist_id: int, folder_id: int | None, position: int | None = None):
    body: dict = {"playlist_id": playlist_id, "folder_id": folder_id}
    if position is not None:
        body["position"] = position
    return api.post("/playlistfolders/move", json=body)


def test_moving_into_an_unknown_folder_keeps_the_current_assignment(folders_api):
    """THE bug: the 404 used to arrive with the playlist already evicted."""
    chill = _create_folder(folders_api, "Chill")
    assert _move(folders_api, 7, chill).status_code == 200
    assert _items(folders_api, chill) == [7]

    res = _move(folders_api, 7, 9999)

    assert res.status_code == 404
    assert res.get_json()["error"] == "Folder not found"
    assert _items(folders_api, chill) == [7], "a failed move must not change any folder"


def test_moving_into_a_folder_appends_by_default(folders_api):
    chill = _create_folder(folders_api, "Chill")

    for playlist_id in (1, 2, 3):
        assert _move(folders_api, playlist_id, chill).status_code == 200

    assert _items(folders_api, chill) == [1, 2, 3]


def test_moving_into_a_folder_at_an_explicit_position(folders_api):
    chill = _create_folder(folders_api, "Chill")
    for playlist_id in (1, 2, 3):
        _move(folders_api, playlist_id, chill)

    res = _move(folders_api, 9, chill, position=1)

    assert res.status_code == 200
    assert res.get_json()["items"] == [1, 9, 2, 3]
    assert _items(folders_api, chill) == [1, 9, 2, 3]


def test_reordering_within_the_same_folder(folders_api):
    chill = _create_folder(folders_api, "Chill")
    for playlist_id in (1, 2, 3):
        _move(folders_api, playlist_id, chill)

    _move(folders_api, 3, chill, position=0)

    assert _items(folders_api, chill) == [3, 1, 2]


def test_moving_to_the_top_level_removes_it_from_its_folder(folders_api):
    chill = _create_folder(folders_api, "Chill")
    _move(folders_api, 7, chill)

    res = _move(folders_api, 7, None)

    assert res.status_code == 200
    assert res.get_json() == {"message": "Playlist moved to top level"}
    assert _items(folders_api, chill) == []


def test_a_playlist_lives_in_at_most_one_folder(folders_api):
    chill = _create_folder(folders_api, "Chill")
    focus = _create_folder(folders_api, "Focus")
    _move(folders_api, 7, chill)

    _move(folders_api, 7, focus)

    assert _items(folders_api, chill) == []
    assert _items(folders_api, focus) == [7]
