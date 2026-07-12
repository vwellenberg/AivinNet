"""Request-cycle tests for UpdatePlaylistForm.

Regression guards for two real production bugs (both introduced by #36 and
only visible in a real multipart request):

1. `image` REQUIRED -> updates without a freshly picked file (rename,
   settings toggle) failed with a silent 422.
2. `FileStorage | None` union annotation -> flask_openapi3 stopped mapping
   the field from request.files, silently DROPPING real uploads while the
   request still returned 200.
"""

import io

SETTINGS = '{"has_gif": false, "banner_pos": 50, "square_img": true, "pinned": false}'


def _put(client, data):
    return client.put(
        "/playlists/26/update",
        data=data,
        content_type="multipart/form-data",
    )


def test_update_without_image_is_valid(form_app):
    # Rename / settings-only updates send NO image part at all.
    res = _put(form_app, {"name": "My Playlist", "settings": SETTINGS})

    assert res.status_code == 200
    body = res.get_json()
    assert body["has_file"] is False
    assert body["filename"] is None
    assert body["name"] == "My Playlist"
    assert body["settings"] == SETTINGS


def test_update_with_real_file_maps_the_upload(form_app):
    # A real multipart file part MUST arrive as a FileStorage on the model.
    # With a `FileStorage | None` union annotation flask_openapi3 never read
    # request.files and the upload was silently dropped.
    res = _put(
        form_app,
        {
            "name": "My Playlist",
            "settings": SETTINGS,
            "image": (io.BytesIO(b"fake-image-bytes"), "cover.png"),
        },
    )

    assert res.status_code == 200
    body = res.get_json()
    assert body["has_file"] is True
    assert body["filename"] == "cover.png"


def test_update_missing_name_is_rejected(form_app):
    res = _put(form_app, {"settings": SETTINGS})

    assert res.status_code == 422


def test_update_missing_settings_is_rejected(form_app):
    res = _put(form_app, {"name": "My Playlist"})

    assert res.status_code == 422
