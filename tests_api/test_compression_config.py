"""flask-compress must only touch JSON — and never stream.

`config_app` used to set `COMPRESS_MIMETYPES` AFTER `Compress(web)`, but
flask-compress copies its settings in `init_app`, so the defaults (text/css,
text/javascript, text/html, …) stayed live. Static files then went out
compressed on the fly as a stream wrapped in `stream_with_context`. bjoern
interleaves connections on one thread, so two such streams popped each other's
request context ("AssertionError: Popped wrong request context") and the
responses died mid-body. Safari hit it on every page load: it is the browser
`serve_client_files` hands the plain files instead of the `.gz` ones. In
WebKit: "Connection terminated unexpectedly", the app never finished loading.

The test client does not interleave connections the way bjoern does, so these
tests pin the response SHAPE that cannot break: a plain body with a
Content-Length, no on-the-fly encoding.
"""

import pytest
from flask import send_from_directory
from flask_openapi3 import OpenAPI

from aivinnet.app_builder import config_app

SAFARI = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Safari/605.1.15"
)
ACCEPT = "gzip, deflate, br, zstd"


@pytest.fixture()
def client(monkeypatch, tmp_path):
    import aivinnet.app_builder as app_builder

    monkeypatch.setattr(app_builder, "prefer_ipv4", lambda: None)

    # Realistic sizes: well above flask-compress's 500-byte minimum.
    (tmp_path / "index.html").write_text("<!doctype html>" + "<p>x</p>" * 400)
    (tmp_path / "FolderView.1535239c.css").write_text(".a{color:red}" * 400)
    (tmp_path / "FolderView.1535239c.js").write_text("console.log(1);" * 400)

    app = OpenAPI(__name__)
    app.config["TESTING"] = True
    config_app(app)

    # Same call shape as `serve_client_files`: a streamed file response.
    @app.route("/static/<name>")
    def static_file(name):
        return send_from_directory(tmp_path, name)

    @app.route("/json")
    def big_json():
        return {"items": ["x" * 50] * 100}

    return app.test_client(), tmp_path


@pytest.mark.parametrize("name", ["index.html", "FolderView.1535239c.css", "FolderView.1535239c.js"])
def test_static_files_are_not_compressed_on_the_fly(client, name):
    http, folder = client

    res = http.get(f"/static/{name}", headers={"User-Agent": SAFARI, "Accept-Encoding": ACCEPT})

    assert res.status_code == 200
    assert "Content-Encoding" not in res.headers
    assert res.headers["Content-Length"] == str((folder / name).stat().st_size)
    assert res.data == (folder / name).read_bytes()


def test_json_is_still_compressed(client):
    http, _ = client

    res = http.get("/json", headers={"Accept-Encoding": "gzip"})

    assert res.headers.get("Content-Encoding") == "gzip"


def test_compression_never_streams(client):
    http, _ = client
    assert http.application.config["COMPRESS_STREAMS"] is False
