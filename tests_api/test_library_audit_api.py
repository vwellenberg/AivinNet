"""The library check through the real request cycle: list, ignore, merge.

`merge` is the one that writes to files, so most of the weight is there: which
files it hands to the tag writer, with what, and that two files sharing one
trackhash (an MP3 next to its WAV) are BOTH written — a lookup by hash edited
one of them twice and reported success (seen live on 2026-10-02).
"""

from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest
from test_metadata_api import await_job


@dataclass
class Track:
    filepath: str
    title: str
    album: str
    albumhash: str
    trackhash: str
    artists: list = field(default_factory=list)
    albumartists: list = field(default_factory=list)

    @property
    def folder(self) -> str:
        return self.filepath.rsplit("/", 1)[0] + "/"


def people(name):
    return [{"name": name}]


SPLIT_ALBUM = [
    Track("/m/Valheim/01 - A.mp3", "A", "Valheim OST", "h1", "t1", people("Freya"), people("Freya")),
    Track("/m/Valheim/02 - B.mp3", "B", "Valheim OST", "h2", "t2", people("Patrik"), people("Patrik")),
    # The same recording twice, as MP3 and WAV: one trackhash, two files.
    Track("/m/Valheim/03 - C.mp3", "C", "Valheim OST", "h2", "t3", people("Patrik"), people("Patrik")),
    Track("/m/Valheim/03 - C.wav", "C", "Valheim OST", "h2", "t3", people("Patrik"), people("Patrik")),
]


@pytest.fixture()
def audit_api(api_client, monkeypatch):
    import aivinnet.api.metadata as metadata_module
    from aivinnet.lib import mbjobs

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    mbjobs.reset_for_tests()

    config = SimpleNamespace(libraryAuditIgnored=[])
    monkeypatch.setattr(metadata_module, "UserConfig", lambda: config)
    monkeypatch.setattr(metadata_module.TrackStore, "get_flat_list", classmethod(lambda cls: list(SPLIT_ALBUM)))

    written = []

    def fake_edit(filepath, fields):
        written.append((filepath, fields))

    monkeypatch.setattr(metadata_module, "edit_track_tags_by_filepath", fake_edit)
    return api_client("aivinnet.api.metadata"), config, written


class TestTheList:
    def test_a_split_album_is_listed(self, audit_api):
        api, _config, _written = audit_api

        res = api.get("/metadata/audit")

        assert res.status_code == 200
        [album] = res.json["albums"]
        assert album["title"] == "Valheim OST"
        assert album["reasons"] == ["split"]
        assert album["fragments"] == 2
        assert album["trackcount"] == 4

    def test_an_ignored_album_is_not(self, audit_api):
        api, config, _written = audit_api
        key = api.get("/metadata/audit").json["albums"][0]["key"]

        res = api.post("/metadata/audit/ignore", json={"key": key})

        assert res.status_code == 200
        assert config.libraryAuditIgnored == [key]
        assert api.get("/metadata/audit").json == {"albums": [], "ignored": 1}

    def test_ignoring_twice_stores_it_once(self, audit_api):
        api, config, _written = audit_api

        api.post("/metadata/audit/ignore", json={"key": "k"})
        api.post("/metadata/audit/ignore", json={"key": "k"})

        assert config.libraryAuditIgnored == ["k"]


class TestMerge:
    def test_every_file_gets_the_album_artist_once(self, audit_api):
        api, _config, written = audit_api

        res = api.post(
            "/metadata/audit/merge",
            json={"folder": "/m/Valheim/", "title": "Valheim OST", "albumartist": "Various Artists"},
        )

        assert res.status_code == 200
        result = await_job(api, res.json["job"])["result"]
        assert result["failed"] == []
        # Both halves of the MP3/WAV pair, each exactly once.
        assert sorted(fp for fp, _ in written) == sorted(t.filepath for t in SPLIT_ALBUM)
        assert all(fields == {"albumartists": ["Various Artists"]} for _, fields in written)

    def test_an_unknown_album_is_404_and_writes_nothing(self, audit_api):
        api, _config, written = audit_api

        res = api.post("/metadata/audit/merge", json={"folder": "/m/Valheim/", "title": "Nope", "albumartist": "X"})

        assert res.status_code == 404
        assert written == []

    def test_an_empty_album_artist_is_refused(self, audit_api):
        api, _config, written = audit_api

        res = api.post(
            "/metadata/audit/merge", json={"folder": "/m/Valheim/", "title": "Valheim OST", "albumartist": ""}
        )

        assert res.status_code == 422
        assert written == []
