"""Fixtures for the API-layer test lane.

Unlike tests/ (fast lane, heavy deps mocked), this lane runs with the FULL
dependency stack (`uv sync`) and exercises the real flask_openapi3 request
cycle. It exists because the request-model layer broke twice in one day
(vwellenberg/AivinNet#36 -> #167/#39) in ways no mocked unit test could see:
required-vs-optional multipart fields and flask_openapi3's file mapping only
misbehave inside a real request.

The app config dir is pointed at a temp directory BEFORE anything from
swingmusic is imported, so no test ever touches a real library.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Must happen before any swingmusic import resolves Paths.
_config_root = tempfile.mkdtemp(prefix="swingmusic-apitests-")
os.environ["XDG_CONFIG_HOME"] = _config_root
os.environ.setdefault("SWINGMUSIC_CLIENT_DIR", _config_root)

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


@pytest.fixture()
def form_app():
    """
    A minimal flask_openapi3 app exposing endpoints built from the REAL
    request models of the playlist API. No auth hooks, no stores, no DB —
    the subject under test is the model <-> request mapping.
    """
    from flask_openapi3 import OpenAPI

    from swingmusic.api.playlist import PlaylistIDPath, UpdatePlaylistForm

    app = OpenAPI(__name__)

    @app.put("/playlists/<playlistid>/update")
    def update_stub(path: PlaylistIDPath, form: UpdatePlaylistForm):
        image = form.image
        return {
            "playlistid": str(path.playlistid),
            "name": form.name,
            "settings": form.settings,
            "has_file": bool(image),
            "filename": image.filename if image else None,
        }

    app.config["TESTING"] = True
    return app.test_client()
