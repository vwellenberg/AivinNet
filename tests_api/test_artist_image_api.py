"""Full-stack tests for the hand-picked artist picture.

Real Pillow, real `Paths`, real SQLite — the fast lane has PIL and the DB
mocked, so the image pipeline and the colour write can only be checked here.
Plus the multipart mapping of the request model, which only a real request
cycle shows (AivinNet-Client#36 -> #167/#39).
"""

import io
from types import SimpleNamespace

import pytest

ARTIST_HASH = "apitestartisthsh"


def _image_bytes(size=(800, 400), color=(200, 30, 60)) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return buffer.getvalue()


def _upload(api, image: bytes, artisthash: str = ARTIST_HASH):
    return api.post(
        "/coverart/artist/upload",
        data={"artisthash": artisthash, "image": (io.BytesIO(image), "me.png")},
        content_type="multipart/form-data",
    )


@pytest.fixture()
def artist_files():
    """The three image files + the user-set marker for one throwaway artist."""
    from aivinnet.lib import artist_image
    from aivinnet.settings import Paths

    paths = Paths()
    files = [
        paths.lg_artist_img_path / f"{ARTIST_HASH}.webp",
        paths.md_artist_img_path / f"{ARTIST_HASH}.webp",
        paths.sm_artist_img_path / f"{ARTIST_HASH}.webp",
    ]
    marker = artist_image.user_set_dir() / ARTIST_HASH

    yield files, marker

    for path in [*files, marker]:
        path.unlink(missing_ok=True)


@pytest.fixture()
def admin_api(api_client, monkeypatch, artist_files):
    """The coverart blueprint, an admin actor, and one artist in the store."""
    from aivinnet.store.artists import ArtistStore

    colors = []
    entry = SimpleNamespace(set_color=colors.append)
    monkeypatch.setattr(ArtistStore, "artistmap", {ARTIST_HASH: entry})
    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})

    return api_client("aivinnet.api.coverart"), colors


class TestPipeline:
    def test_save_writes_three_square_sizes_and_marks_the_artist(self, artist_files):
        from PIL import Image

        from aivinnet.lib import artist_image

        files, marker = artist_files

        assert artist_image.save_artist_image_bytes(ARTIST_HASH, _image_bytes()) == f"{ARTIST_HASH}.webp"

        # A landscape photo comes out square, capped per size, never upscaled.
        expected = [(400, 400), (256, 256), (128, 128)]
        for path, size in zip(files, expected, strict=True):
            with Image.open(path) as img:
                assert img.size == size
        assert marker.exists()

    def test_a_large_photo_is_capped_at_500(self, artist_files):
        from PIL import Image

        from aivinnet.lib import artist_image

        files, _ = artist_files
        artist_image.save_artist_image_bytes(ARTIST_HASH, _image_bytes(size=(3000, 4000)))

        with Image.open(files[0]) as img:
            assert img.size == (500, 500)

    def test_not_an_image_saves_nothing(self, artist_files):
        from aivinnet.lib import artist_image

        files, marker = artist_files

        assert artist_image.save_artist_image_bytes(ARTIST_HASH, b"definitely not a picture") is None
        assert not any(path.exists() for path in files)
        assert not marker.exists()

    def test_remove_deletes_the_files_and_keeps_the_decision(self, artist_files):
        from aivinnet.lib import artist_image

        files, marker = artist_files
        artist_image.save_artist_image_bytes(ARTIST_HASH, _image_bytes())

        artist_image.remove_artist_image(ARTIST_HASH)

        assert not any(path.exists() for path in files)
        assert marker.exists()

    def test_the_online_lookup_leaves_a_removed_picture_removed(self, artist_files, monkeypatch):
        from aivinnet.lib import artist_image, artistlib

        artist_image.remove_artist_image(ARTIST_HASH)
        looked_up = []
        monkeypatch.setattr(artistlib, "get_artist_image_link", looked_up.append)

        artistlib.CheckArtistImages.download_image(SimpleNamespace(name="Some Band", artisthash=ARTIST_HASH))

        assert looked_up == []

    def test_the_placeholder_purge_keeps_a_picture_set_on_purpose(self):
        """A picture uploaded FOR "Unknown" must survive the start-up purge."""
        from aivinnet.lib import artist_image
        from aivinnet.lib.placeholder_artists import purge_placeholder_artist_images
        from aivinnet.settings import Paths
        from aivinnet.utils.hashing import create_hash

        unknown = create_hash("Unknown", decode=True)
        path = Paths().sm_artist_img_path / f"{unknown}.webp"
        try:
            artist_image.save_artist_image_bytes(unknown, _image_bytes())

            purge_placeholder_artist_images([Paths().sm_artist_img_path], user_set_dir=artist_image.user_set_dir())

            assert path.exists()
        finally:
            artist_image.remove_artist_image(unknown)
            (artist_image.user_set_dir() / unknown).unlink(missing_ok=True)


class TestEndpoints:
    def test_upload_saves_the_picture_and_the_colour(self, admin_api, artist_files):
        from aivinnet.db.userdata import LibDataTable

        api, colors = admin_api
        files, _ = artist_files

        res = _upload(api, _image_bytes())

        assert res.status_code == 200, res.get_json()
        body = res.get_json()
        assert body["image"] == f"{ARTIST_HASH}.webp"
        assert body["color"].startswith("rgb(")
        assert all(path.exists() for path in files)
        # Stored AND pushed into the RAM store — the page reads the latter.
        assert LibDataTable.find_one(ARTIST_HASH, type="artist").color == body["color"]
        assert colors == [body["color"]]

    def test_a_new_upload_replaces_the_colour(self, admin_api):
        from aivinnet.db.userdata import LibDataTable

        api, _ = admin_api
        first = _upload(api, _image_bytes(color=(200, 30, 60))).get_json()["color"]
        second = _upload(api, _image_bytes(color=(20, 60, 200))).get_json()["color"]

        # The scan-time colour pass skips artists that already have a colour;
        # an upload must not.
        assert first != second
        assert LibDataTable.find_one(ARTIST_HASH, type="artist").color == second

    def test_remove_clears_picture_and_colour(self, admin_api, artist_files):
        from aivinnet.db.userdata import LibDataTable

        api, colors = admin_api
        files, _ = artist_files
        _upload(api, _image_bytes())

        res = api.post("/coverart/artist/remove", json={"artisthash": ARTIST_HASH})

        assert res.status_code == 200
        assert not any(path.exists() for path in files)
        assert LibDataTable.find_one(ARTIST_HASH, type="artist").color == ""
        assert colors[-1] == ""

    def test_upload_without_a_file_is_rejected(self, admin_api):
        api, _ = admin_api

        res = api.post("/coverart/artist/upload", data={"artisthash": ARTIST_HASH}, content_type="multipart/form-data")

        assert res.status_code == 422

    def test_not_an_image_answers_400(self, admin_api, artist_files):
        api, _ = admin_api

        assert _upload(api, b"nope").status_code == 400

    def test_unknown_artist_answers_404(self, admin_api):
        api, _ = admin_api

        assert _upload(api, _image_bytes(), artisthash="notinthelibrary").status_code == 404
        assert api.post("/coverart/artist/remove", json={"artisthash": "notinthelibrary"}).status_code == 404
