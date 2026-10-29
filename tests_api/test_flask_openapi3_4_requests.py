"""Request-cycle guards for the flask_openapi3 4.x migration (#612).

flask_openapi3 4.x changed two things the app relied on, and both only show up
in a real request, never in a unit test of the model:

1. Every non-file form value is run through ``json.loads``. A text field whose
   content happens to be JSON reached pydantic as a number, bool or dict and
   failed the ``str`` check with 422. Playlists named ``2024`` could not be
   renamed, the ``settings`` JSON of ``PUT /playlists/<id>/update`` never got
   through, and an all-digit album hash was refused by the cover upload.
2. A request without a body is passed on as ``None``. 3.x read it as ``{}``, so
   an endpoint whose body fields all have defaults answered 200. Under 4.x it
   answered 422.

Each test builds its own small app around the REAL request models, the same way
``test_update_playlist_form.py`` does.
"""

import io

import pytest
from flask_openapi3 import OpenAPI
from pydantic import Field

from aivinnet.api.apischemas import JsonBodyModel
from aivinnet.api.auth import UpdateProfileBody
from aivinnet.api.backup_and_restore import RestoreBackupBody
from aivinnet.api.coverart import UploadAlbumCoverForm
from aivinnet.api.folder import DirBrowserBody, FolderTree
from aivinnet.api.home import HomeLayoutBody
from aivinnet.api.musicbrainz import FetchMissingBody
from aivinnet.api.playlist import UpdatePlaylistForm
from aivinnet.api.track import EditTagsBody

SETTINGS = '{"has_gif": false, "banner_pos": 50, "square_img": true, "pinned": false}'


def _playlist_app():
    app = OpenAPI("form-text")
    seen = {}

    @app.put("/playlists/<playlistid>/update")
    def update(form: UpdatePlaylistForm):
        seen["name"] = form.name
        seen["settings"] = form.settings
        return {"ok": True}

    return app, seen


def _cover_app():
    app = OpenAPI("form-text-cover")
    seen = {}

    @app.post("/album/upload")
    def upload(form: UploadAlbumCoverForm):
        seen["albumhash"] = form.albumhash
        return {"ok": True}

    return app, seen


@pytest.mark.parametrize("name", ["2024", "true", "null", "1.50", "1e3", "  007  "])
def test_playlist_name_that_looks_like_json_arrives_as_sent(name):
    app, seen = _playlist_app()
    res = app.test_client().put(
        "/playlists/26/update",
        data={"name": name, "settings": SETTINGS},
        content_type="multipart/form-data",
    )

    assert res.status_code == 200, res.get_data(as_text=True)
    assert seen["name"] == name


def test_settings_json_object_arrives_as_the_text_that_was_sent():
    app, seen = _playlist_app()
    res = app.test_client().put(
        "/playlists/26/update",
        data={"name": "x", "settings": SETTINGS},
        content_type="multipart/form-data",
    )

    assert res.status_code == 200, res.get_data(as_text=True)
    assert seen["settings"] == SETTINGS


@pytest.mark.parametrize("albumhash", ["1234567890123456", "0e12345678901234"])
def test_all_digit_album_hash_is_accepted_as_text(albumhash):
    app, seen = _cover_app()
    res = app.test_client().post(
        "/album/upload",
        data={"albumhash": albumhash, "image": (io.BytesIO(b"fake-image-bytes"), "cover.png")},
        content_type="multipart/form-data",
    )

    assert res.status_code == 200, res.get_data(as_text=True)
    assert seen["albumhash"] == albumhash


@pytest.mark.parametrize(
    "model",
    [UpdateProfileBody, RestoreBackupBody, FolderTree, DirBrowserBody, HomeLayoutBody, FetchMissingBody, EditTagsBody],
)
def test_all_optional_json_body_without_a_body_uses_the_defaults(model):
    app = OpenAPI("optional-body")

    @app.post("/x")
    def handler(body: model):
        return {"ok": True}

    client = app.test_client()
    assert client.post("/x").status_code == 200
    assert client.post("/x", json={}).status_code == 200


def test_body_with_a_required_field_still_rejects_an_empty_body():
    class NeedsName(JsonBodyModel):
        name: str = Field(..., description="required")

    app = OpenAPI("required-body")

    @app.post("/x")
    def handler(body: NeedsName):
        return {"ok": True}

    res = app.test_client().post("/x")
    assert res.status_code == 422
