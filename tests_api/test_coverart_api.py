"""Full-stack tests for the album cover endpoints.

Two things only this lane can see:

1. The multipart request model. ``UploadAlbumCoverForm`` declares its file as a
   plain ``FileStorage`` — with a ``FileStorage | None`` union flask_openapi3
   stops mapping ``request.files`` and drops real uploads while still answering
   200. That is a shipped bug (AivinNet-Client#36 -> #167/#39), invisible to any
   mocked unit test, so every new form model gets a request-cycle test.

2. The cover pipeline against real Pillow and real ``Paths``. The fast lane has
   PIL mocked, so save/remove/undo can only be verified for real here.
"""

import io

import pytest


@pytest.fixture()
def upload_form_app():
    """
    A minimal flask_openapi3 app exposing the REAL upload request model.
    No auth hooks, no stores — the subject under test is the model mapping.
    """
    from flask_openapi3 import OpenAPI

    from swingmusic.api.coverart import UploadAlbumCoverForm

    app = OpenAPI(__name__)

    @app.post("/coverart/album/upload")
    def upload_stub(form: UploadAlbumCoverForm):
        return {
            "albumhash": form.albumhash,
            "has_file": bool(form.image),
            "filename": form.image.filename if form.image else None,
            "size": len(form.image.read()) if form.image else 0,
        }

    app.config["TESTING"] = True
    return app.test_client()


def test_upload_maps_the_file_part(upload_form_app):
    res = upload_form_app.post(
        "/coverart/album/upload",
        data={"albumhash": "ALB123", "image": (io.BytesIO(b"fake-image-bytes"), "cover.png")},
        content_type="multipart/form-data",
    )

    assert res.status_code == 200
    body = res.get_json()
    assert body["albumhash"] == "ALB123"
    assert body["has_file"] is True
    assert body["filename"] == "cover.png"
    assert body["size"] == len(b"fake-image-bytes")


def test_upload_without_a_file_is_rejected(upload_form_app):
    # Unlike the playlist update (where the image is optional), an upload with
    # no image has nothing to do — it must fail loudly, not save nothing.
    res = upload_form_app.post(
        "/coverart/album/upload",
        data={"albumhash": "ALB123"},
        content_type="multipart/form-data",
    )

    assert res.status_code == 422


def test_upload_without_an_albumhash_is_rejected(upload_form_app):
    res = upload_form_app.post(
        "/coverart/album/upload",
        data={"image": (io.BytesIO(b"fake-image-bytes"), "cover.png")},
        content_type="multipart/form-data",
    )

    assert res.status_code == 422


def _png_bytes(color=(200, 30, 60)) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (600, 600), color).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture()
def album_cover_paths():
    """The four thumbnail paths + the removal marker for one throwaway album."""
    from swingmusic.lib import coverart
    from swingmusic.settings import Paths

    albumhash = "apitestalbumhash"
    paths = Paths()
    files = [
        paths.lg_thumb_path / f"{albumhash}.webp",
        paths.md_thumb_path / f"{albumhash}.webp",
        paths.sm_thumb_path / f"{albumhash}.webp",
        paths.xsm_thumb_path / f"{albumhash}.webp",
    ]

    yield albumhash, files, coverart._album_cover_tombstone(albumhash)

    # Leave the temp config as we found it, undo snapshots included.
    for path in files:
        path.unlink(missing_ok=True)
        path.with_name(path.name + ".undo").unlink(missing_ok=True)

    tombstone = coverart._album_cover_tombstone(albumhash)
    tombstone.unlink(missing_ok=True)
    tombstone.with_name(tombstone.name + ".undo").unlink(missing_ok=True)


class TestCoverPipeline:
    def test_save_writes_all_four_sizes(self, album_cover_paths):
        from swingmusic.lib import coverart

        albumhash, files, _ = album_cover_paths

        assert coverart.save_album_cover_bytes(albumhash, _png_bytes()) == f"{albumhash}.webp"
        for path in files:
            assert path.exists() and path.stat().st_size > 0

    def test_remove_deletes_the_files_and_marks_the_album(self, album_cover_paths):
        from swingmusic.lib import coverart

        albumhash, files, tombstone = album_cover_paths
        coverart.save_album_cover_bytes(albumhash, _png_bytes())

        coverart.remove_album_cover(albumhash)

        for path in files:
            assert not path.exists()
        assert tombstone.exists()
        assert coverart.album_cover_removed(albumhash) is True

    def test_undo_brings_the_cover_back(self, album_cover_paths):
        from swingmusic.lib import coverart

        albumhash, files, tombstone = album_cover_paths
        coverart.save_album_cover_bytes(albumhash, _png_bytes())
        before = files[0].read_bytes()

        coverart.remove_album_cover(albumhash)
        assert coverart.undo_album_cover(albumhash) is True

        assert files[0].read_bytes() == before
        assert not tombstone.exists()

    def test_saving_a_new_cover_lifts_an_earlier_removal(self, album_cover_paths):
        from swingmusic.lib import coverart

        albumhash, files, tombstone = album_cover_paths
        coverart.remove_album_cover(albumhash)

        coverart.save_album_cover_bytes(albumhash, _png_bytes((10, 200, 90)))

        assert not tombstone.exists()
        assert coverart.album_cover_removed(albumhash) is False
        for path in files:
            assert path.exists()

    def test_undoing_that_save_returns_to_the_removed_state(self, album_cover_paths):
        from swingmusic.lib import coverart

        albumhash, files, tombstone = album_cover_paths
        coverart.remove_album_cover(albumhash)
        coverart.save_album_cover_bytes(albumhash, _png_bytes((10, 200, 90)))

        assert coverart.undo_album_cover(albumhash) is True

        # The state before the save was "the user removed this cover", so that
        # is what an undo has to restore — not the cover from before that.
        assert tombstone.exists()
        for path in files:
            assert not path.exists()


class TestEmbeddableCover:
    def test_builds_a_jpeg_from_the_stored_thumbnail(self, album_cover_paths):
        from swingmusic.lib import coverart
        from swingmusic.lib.album_cover_edit import build_embeddable_cover

        albumhash, _, _ = album_cover_paths
        coverart.save_album_cover_bytes(albumhash, _png_bytes())

        data, width, height = build_embeddable_cover(albumhash)

        assert data.startswith(b"\xff\xd8\xff")  # JPEG SOI
        assert width > 0 and height > 0

        from PIL import Image

        with Image.open(io.BytesIO(data)) as img:
            assert img.format == "JPEG"
            assert img.size == (width, height)

    def test_an_album_without_a_cover_raises(self, album_cover_paths):
        from swingmusic.lib.album_cover_edit import AlbumCoverError, build_embeddable_cover

        albumhash, _, _ = album_cover_paths

        with pytest.raises(AlbumCoverError):
            build_embeddable_cover(albumhash)
