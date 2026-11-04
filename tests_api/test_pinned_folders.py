"""Pinning a music folder to the library sidebar (POST /folder/pin_unpin & co).

Folders are not DB rows, so a pin is a `pinned_folder` row in the per-user
favorites table, keyed by the folder's path. Three things have to hold for that
to be safe, and each is a test below:

- ONE spelling per folder (`pin_key`): `/music/Rock`, `/music/Rock/` and a
  backslash spelling are one pin, not three.
- Checks before writes: a folder outside the roots (403) or a path that is not
  a directory (400) writes nothing — `.claude/rules/api-endpoints.md`.
- The pins are the CURRENT user's, and they never count as favourites.
"""

from types import SimpleNamespace

import pytest


@pytest.fixture()
def pins(api_client, monkeypatch, tmp_path):
    import aivinnet.api.folder as folder_api

    root = tmp_path / "music"
    (root / "Rock" / "Live").mkdir(parents=True)
    (root / "Jazz").mkdir()
    (root / "song.mp3").write_bytes(b"")
    outside = tmp_path / "elsewhere"
    outside.mkdir()

    root_prefix = root.resolve().as_posix() + "/"
    monkeypatch.setattr(
        folder_api,
        "is_path_within_root_dirs",
        lambda p: (folder_api.safe_dir_prefix(p)).startswith(root_prefix),
    )
    # Counted from the RAM store, which stays empty in this lane: one file per
    # folder is enough to see the count reach the card.
    from sortedcontainers import SortedSet

    monkeypatch.setattr(
        folder_api.FolderStore, "filepaths", SortedSet([(root / "Rock" / "a.mp3").resolve().as_posix()])
    )

    api = api_client("aivinnet.api.folder")

    def toggle(path):
        return api.post("/folder/pin_unpin", json={"path": str(path)})

    def listed():
        res = api.get("/folder/pinned")
        assert res.status_code == 200, res.get_data(as_text=True)
        return res.get_json()["folders"]

    return SimpleNamespace(api=api, root=root, outside=outside, toggle=toggle, listed=listed)


def _key(path) -> str:
    return path.resolve().as_posix() + "/"


def test_pinning_a_folder_lists_it_with_name_count_and_no_position(pins):
    res = pins.toggle(pins.root / "Rock")

    assert res.status_code == 200
    assert res.get_json() == {"pinned": True, "path": _key(pins.root / "Rock")}

    [folder] = pins.listed()
    assert folder["name"] == "Rock"
    assert folder["path"] == _key(pins.root / "Rock")
    assert folder["trackcount"] == 1
    assert folder["position"] is None


def test_a_second_toggle_unpins(pins):
    pins.toggle(pins.root / "Rock")
    res = pins.toggle(pins.root / "Rock")

    assert res.get_json() == {"pinned": False, "path": _key(pins.root / "Rock")}
    assert pins.listed() == []


def test_every_spelling_of_a_folder_is_the_same_pin(pins):
    rock = pins.root / "Rock"
    pins.toggle(rock)

    # Trailing slash (folder cards) and a detour through `..` hit the same row.
    assert pins.toggle(str(rock) + "/").get_json()["pinned"] is False
    pins.toggle(rock / "Live" / "..")

    assert [f["path"] for f in pins.listed()] == [_key(rock)]


def test_a_folder_outside_the_roots_is_refused_and_nothing_is_written(pins):
    res = pins.toggle(pins.outside)

    assert res.status_code == 403
    assert pins.listed() == []
    from aivinnet.db.userdata import FavoritesTable

    assert not FavoritesTable.check_exists(_key(pins.outside), "pinned_folder")


def test_a_file_or_a_missing_path_is_no_folder_and_nothing_is_written(pins):
    assert pins.toggle(pins.root / "song.mp3").status_code == 400
    assert pins.toggle(pins.root / "gone").status_code == 400
    assert pins.listed() == []


def test_a_pin_whose_folder_vanished_can_still_be_unpinned(pins):
    jazz = pins.root / "Jazz"
    pins.toggle(jazz)
    jazz.rmdir()

    # Still listed (an offline share looks the same), and still removable.
    assert [f["name"] for f in pins.listed()] == ["Jazz"]
    res = pins.toggle(jazz)
    assert res.status_code == 200
    assert res.get_json()["pinned"] is False
    assert pins.listed() == []


def test_reorder_sets_explicit_positions_and_ignores_unpinned_paths(pins):
    rock, jazz = pins.root / "Rock", pins.root / "Jazz"
    pins.toggle(rock)
    pins.toggle(jazz)

    res = pins.api.post(
        "/folder/pinned/order",
        json={
            "positions": [
                # The client may send its own spelling; it lands on the pin.
                {"path": str(rock), "position": 4},
                {"path": _key(jazz), "position": 1},
                {"path": _key(pins.outside), "position": 0},
            ]
        },
    )

    assert res.status_code == 200
    assert {f["name"]: f["position"] for f in pins.listed()} == {"Rock": 4, "Jazz": 1}


def test_pins_belong_to_one_user(pins):
    pins.toggle(pins.root / "Rock")

    pins.api.userid = 2
    assert pins.listed() == []
    # User 2 pinning the same folder is their own row, not a toggle of user 1's.
    assert pins.toggle(pins.root / "Rock").get_json()["pinned"] is True

    pins.api.userid = 1
    assert len(pins.listed()) == 1


def test_a_folder_named_like_the_prefix_keeps_its_path(pins):
    """`Favorite` stripped its type prefix with `replace`, i.e. everywhere."""
    odd = pins.root / "pinned_folder_rarities"
    odd.mkdir()
    pins.toggle(odd)

    assert [f["path"] for f in pins.listed()] == [_key(odd)]


def test_a_pinned_folder_is_no_new_favorite(pins):
    import time

    from aivinnet.db.userdata import FavoritesTable

    pins.toggle(pins.root / "Rock")
    now = int(time.time())

    assert FavoritesTable.count_favs_in_period(now - 60, now + 60) == 0
