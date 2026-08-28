"""Body limits, security headers and file permissions.

Three small guards that were entirely absent. Each is cheap to add and cheap to
delete again by accident, which is what makes them worth pinning.
"""

import os
import stat

import pytest


@pytest.fixture(scope="module")
def hardened_app():
    import importlib

    from aivinnet.app_builder import build
    from aivinnet.db import create_all_tables
    from aivinnet.settings import Paths

    for module in ("aivinnet.db.libdata", "aivinnet.db.metadata", "aivinnet.db.userdata"):
        importlib.import_module(module)
    create_all_tables()

    client_dir = Paths().client_path
    client_dir.mkdir(parents=True, exist_ok=True)
    (client_dir / "index.html").write_text("<!doctype html><title>test</title>")

    app = build()
    app.config["TESTING"] = True

    return app


class TestBodyLimits:
    def test_a_limit_exists_at_all(self, hardened_app):
        """There was none, which is the whole point."""
        assert hardened_app.config["MAX_CONTENT_LENGTH"] == 32 * 1024 * 1024

    def test_an_oversized_body_is_refused(self, hardened_app):
        """
        413 before the handler, on the endpoint that needs no token — that is
        where an unauthenticated caller could previously buffer any amount of
        data into the memory of a server that handles one request at a time.
        """
        client = hardened_app.test_client()

        res = client.post(
            "/auth/login",
            data=b"x" * (33 * 1024 * 1024),
            content_type="application/json",
        )

        assert res.status_code == 413

    def test_a_normal_login_body_still_gets_through(self, hardened_app):
        """The limit must not be so tight it breaks the app it protects."""
        client = hardened_app.test_client()

        res = client.post("/auth/login", json={"username": "nobody", "password": "wrong"})

        assert res.status_code != 413

    def test_pillow_will_not_decode_a_bomb(self, hardened_app):
        from PIL import Image

        assert Image.MAX_IMAGE_PIXELS == 64_000_000


class TestSecurityHeaders:
    @pytest.mark.parametrize(
        ("header", "value"),
        [
            ("X-Frame-Options", "DENY"),
            ("Content-Security-Policy", "frame-ancestors 'none'"),
            ("X-Content-Type-Options", "nosniff"),
            ("Referrer-Policy", "same-origin"),
        ],
    )
    def test_present_on_the_client_page(self, hardened_app, header, value):
        """The page that can be framed is the one that matters for clickjacking."""
        res = hardened_app.test_client().get("/")

        assert res.headers.get(header) == value

    def test_present_on_an_api_error_too(self, hardened_app):
        """A 401 is still a response a browser renders decisions from."""
        res = hardened_app.test_client().get("/auth/user")

        assert res.status_code == 401
        assert res.headers.get("X-Frame-Options") == "DENY"


class TestFilePermissions:
    def test_the_config_file_is_owner_only(self):
        """
        Holds `serverId` — the JWT signing key AND the password salt. It was
        written with the process umask, which on the deployment host meant 0664.
        """
        from aivinnet.config import UserConfig

        config = UserConfig()
        config.write_to_file({"serverId": "x"})

        mode = stat.S_IMODE(os.stat(config._config_path).st_mode)

        assert mode == 0o600, f"config file is {oct(mode)}, expected 0o600"

    def test_the_database_and_its_sidecars_are_owner_only(self, tmp_path):
        """
        ⚠️ The database is three files in WAL mode, and the sidecars carry the
        newest transactions — locking down only the .db leaves those readable.
        """
        from aivinnet.utils.filesystem import restrict_database_files

        db = tmp_path / "aivinnet.db"
        for name in ("aivinnet.db", "aivinnet.db-wal", "aivinnet.db-shm"):
            (tmp_path / name).write_text("x")
            os.chmod(tmp_path / name, 0o644)

        restrict_database_files(db)

        for name in ("aivinnet.db", "aivinnet.db-wal", "aivinnet.db-shm"):
            mode = stat.S_IMODE(os.stat(tmp_path / name).st_mode)
            assert mode == 0o600, f"{name} is {oct(mode)}"

    def test_a_missing_sidecar_is_not_an_error(self, tmp_path):
        """WAL sidecars only exist once the database has been written to."""
        from aivinnet.utils.filesystem import restrict_database_files

        db = tmp_path / "lonely.db"
        db.write_text("x")

        restrict_database_files(db)  # must not raise

        assert stat.S_IMODE(os.stat(db).st_mode) == 0o600
