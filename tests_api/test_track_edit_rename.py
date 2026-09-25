"""PUT /track/<hash>/tags with `rename_file` (#144): the single-track editor renames too.

The tag edit and the rename are stubbed at the module seam — what is under
test is the endpoint's contract: the flag is not a tag, the rename runs only
after a successful edit and only when asked, and a rename that cannot happen
reports itself next to the edited track instead of failing a write that already
happened. The rename itself is covered against real files in tests/.
"""

import pytest

OLD = "/m/A/track3.mp3"
NEW = "/m/A/03 - Game Lost.mp3"


class FakeTrack:
    def __init__(self):
        self.filepath = OLD
        self.trackhash = "new-hash"


@pytest.fixture()
def track_api(api_client, monkeypatch):
    import aivinnet.api.track as module

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})

    edited = FakeTrack()
    calls = {"edit": [], "rename": []}

    def fake_edit(trackhash, fields):
        calls["edit"].append((trackhash, dict(fields)))
        return edited

    def fake_rename(moves):
        calls["rename"].append(list(moves))
        # The real one moves the Track object along; so does this.
        edited.filepath = NEW
        return [{"filepath": OLD, "new_filepath": NEW}], []

    monkeypatch.setattr(module, "edit_track_tags", fake_edit)
    monkeypatch.setattr(module, "rename_files", fake_rename)
    monkeypatch.setattr(module, "name_after_tags", lambda track: "03 - Game Lost.mp3")
    monkeypatch.setattr(module, "serialize_track", lambda track: {"filepath": track.filepath})

    return api_client("aivinnet.api.track"), module, calls


def test_without_the_flag_nothing_is_renamed(track_api):
    api, _module, calls = track_api

    res = api.put("/track/old-hash/tags", json={"title": "Game Lost"})

    assert res.status_code == 200
    assert calls["rename"] == []
    assert "rename" not in res.json
    assert res.json["track"] == {"filepath": OLD}


def test_the_flag_renames_after_the_tags_and_is_not_a_tag(track_api):
    api, _module, calls = track_api

    res = api.put("/track/old-hash/tags", json={"title": "Game Lost", "track": 3, "rename_file": True})

    assert res.status_code == 200
    # Not passed on as a tag field.
    assert calls["edit"] == [("old-hash", {"title": "Game Lost", "track": 3})]
    assert calls["rename"] == [[(OLD, "03 - Game Lost.mp3")]]
    assert res.json["rename"] == {"name": "03 - Game Lost.mp3"}
    # Serialised AFTER the rename: the client gets the path the file has now.
    assert res.json["track"] == {"filepath": NEW}


def test_a_taken_name_keeps_the_tags_and_says_so(track_api, monkeypatch):
    api, module, calls = track_api
    monkeypatch.setattr(
        module, "rename_files", lambda moves: ([], [{"filepath": OLD, "error": "Another file already has that name"}])
    )

    res = api.put("/track/old-hash/tags", json={"title": "Game Lost", "rename_file": True})

    assert res.status_code == 200
    assert res.json["rename"] == {"error": "Another file already has that name"}
    assert res.json["track"] == {"filepath": OLD}
    assert len(calls["edit"]) == 1


def test_a_name_that_is_already_right_is_not_moved(track_api, monkeypatch):
    api, module, calls = track_api
    monkeypatch.setattr(module, "name_after_tags", lambda track: "track3.mp3")

    res = api.put("/track/old-hash/tags", json={"title": "x", "rename_file": True})

    assert res.json["rename"] == {"name": "track3.mp3", "unchanged": True}
    assert calls["rename"] == []


def test_tags_that_give_no_name_are_reported(track_api, monkeypatch):
    api, module, calls = track_api
    monkeypatch.setattr(module, "name_after_tags", lambda track: None)

    res = api.put("/track/old-hash/tags", json={"title": "???", "rename_file": True})

    assert res.status_code == 200
    assert res.json["rename"] == {"error": "The tags give no usable file name"}
    assert calls["rename"] == []


def test_the_flag_alone_is_not_an_edit(track_api):
    api, _module, calls = track_api

    res = api.put("/track/old-hash/tags", json={"rename_file": True})

    assert res.status_code == 400
    assert calls["edit"] == []
    assert calls["rename"] == []


def test_a_failed_edit_renames_nothing(track_api, monkeypatch):
    api, module, calls = track_api
    from aivinnet.lib.track_edit import TrackEditError

    def boom(trackhash, fields):
        raise TrackEditError("file is read-only")

    monkeypatch.setattr(module, "edit_track_tags", boom)

    res = api.put("/track/old-hash/tags", json={"title": "Game Lost", "rename_file": True})

    assert res.status_code == 400
    assert calls["rename"] == []
