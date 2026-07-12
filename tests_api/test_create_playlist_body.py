"""Request-cycle tests for the create-playlist request model."""

import pytest
from flask_openapi3 import OpenAPI


@pytest.fixture()
def create_app():
    from swingmusic.api.playlist import CreatePlaylistBody

    app = OpenAPI(__name__)

    @app.post("/playlists/new")
    def create_stub(body: CreatePlaylistBody):
        return {"name": body.name}, 201

    app.config["TESTING"] = True
    return app.test_client()


def test_create_with_name_is_valid(create_app):
    res = create_app.post("/playlists/new", json={"name": "My Playlist"})

    assert res.status_code == 201
    assert res.get_json()["name"] == "My Playlist"


def test_create_without_name_is_rejected(create_app):
    res = create_app.post("/playlists/new", json={})

    assert res.status_code == 422


def test_create_with_non_json_body_is_rejected(create_app):
    res = create_app.post("/playlists/new", data="name=My Playlist", content_type="application/x-www-form-urlencoded")

    assert res.status_code in (415, 422)
