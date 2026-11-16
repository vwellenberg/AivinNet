from pathlib import Path

from flask import send_from_directory
from flask_openapi3 import APIBlueprint, Tag
from PIL import Image
from pydantic import BaseModel, Field

from aivinnet.lib.artwork import find_image, warn_once
from aivinnet.settings import Defaults, Paths
from aivinnet.utils.threading import background
from aivinnet.utils.thumbs import crop_box, thumb_size

bp_tag = Tag(name="Images", description="Image filenames are constructured as '{itemhash}.webp'")
api = APIBlueprint("imgserver", __name__, url_prefix="/img", abp_tags=[bp_tag])


@background
def cache_thumbnails(filepath: Path, trackhash: str):
    """
    Resizes the image and stores it in the cache directory.
    """
    image = Image.open(filepath)
    try:
        path = Path(Paths().image_cache_path)
        box = crop_box(image.width, image.height)  # odd shapes keep their centre (#391)
        if box:
            cropped = image.crop(box)
            image.close()
            image = cropped

        sizes = {
            "xsmall": 64,
            "small": 96,
            "medium": 256,
            "large": 512,
        }

        for size, width in sizes.items():
            resized_path = path / size / (trackhash + ".webp")
            resized_path.parent.mkdir(parents=True, exist_ok=True)
            resized = image.resize(thumb_size(image.width, image.height, width, upscale=False))
            resized.save(resized_path, format="webp")
            resized.close()
    finally:
        image.close()


# Marks a response as a placeholder, naming the entity it stands for. The web
# client asks for it (HEAD) before reading colours from a cover: since #395 the
# placeholders are an ink glyph on a transparent tile, and read as artwork they
# would yield a near-black page gradient. A header instead of a guess from the
# pixels, because real covers and artist cut-outs keep their alpha channel too.
PLACEHOLDER_HEADER = "X-Aivinnet-Placeholder"
PLACEHOLDER_ENTITY = {
    "default.webp": "album",
    "track.webp": "track",
    "artist.webp": "artist",
    "playlist.svg": "playlist",
}


def send_fallback_img(filename: str = "default.webp"):
    """
    Returns the fallback image from the assets folder, marked as a placeholder.
    """
    folder = Paths().assets_path
    img = Path(folder) / filename

    if not img.exists():
        return "", 404

    response = send_from_directory(folder, filename)
    response.headers[PLACEHOLDER_HEADER] = PLACEHOLDER_ENTITY.get(filename, "other")
    return response


def send_file_or_fallback(folder: str, filename: str, fallback: str = "default.webp", pathhash: str = ""):
    """
    Returns the file from the folder or the fallback image.
    """
    found = find_image(folder, filename, pathhash)
    if found is None:
        return send_fallback_img(fallback)

    try:
        response = send_from_directory(found.directory, found.name)
    except OSError as error:
        # Found but not readable after all (permissions, a mount gone since
        # the lookup): the placeholder, as for any image that cannot be read.
        warn_once(str(found.directory), "Image not readable, serving the placeholder: %s (%s)", found.name, error)
        return send_fallback_img(fallback)

    if found.cache_as is not None:
        # INFO: Cache the album folder's cover as thumbnails
        cache_thumbnails(Path(found.directory) / found.name, found.cache_as)

    return response


class ImagePath(BaseModel):
    imgpath: str = Field(
        description="The image filename",
        example=Defaults.API_ALBUMHASH + ".webp",
    )


class ImageQuery(BaseModel):
    pathhash: str = Field(
        description="The path hash used to find the thumbnail",
        default="",
    )
    fb: str = Field(
        description="Fallback entity when the cover is missing: 'track' serves "
        "the note placeholder instead of the record (album) one",
        default="",
    )


def thumbnail_fallback(query: ImageQuery) -> str:
    """
    Picks the placeholder for a missing cover.

    The thumbnail URL is the same file for a track and its album, so the
    entity has to travel with the URL: the track serializer appends
    `fb=track`, album images carry nothing and keep the record placeholder.
    """
    return "track.webp" if query.fb == "track" else "default.webp"


# @api.get("/t/o/<imgpath>")
# def send_original_thumbnail(path: ImagePath):
#     """
#     Get original thumbnail
#     """
#     folder = Paths.get_original_thumb_path()
#     fpath = Path(folder) / path.imgpath

#     if fpath.exists():
#         return send_from_directory(folder, path.imgpath)

#     return send_fallback_img()


# TRACK THUMBNAILS
@api.get("/thumbnail/<imgpath>")
def send_lg_thumbnail(path: ImagePath, query: ImageQuery):
    """
    Get large thumbnail (500 x 500)
    """
    folder = Paths().lg_thumb_path
    return send_file_or_fallback(folder, path.imgpath, thumbnail_fallback(query), pathhash=query.pathhash)


@api.get("/thumbnail/xsmall/<imgpath>")
def send_xsm_thumbnail(path: ImagePath, query: ImageQuery):
    """
    Get extra small thumbnail (64px)
    """
    folder = Paths().xsm_thumb_path
    return send_file_or_fallback(folder, path.imgpath, thumbnail_fallback(query), pathhash=query.pathhash)


@api.get("/thumbnail/small/<imgpath>")
def send_sm_thumbnail(path: ImagePath, query: ImageQuery):
    """
    Get small thumbnail (96px)
    """
    folder = Paths().sm_thumb_path
    return send_file_or_fallback(folder, path.imgpath, thumbnail_fallback(query), pathhash=query.pathhash)


@api.get("/thumbnail/medium/<imgpath>")
def send_md_thumbnail(path: ImagePath, query: ImageQuery):
    """
    Get medium thumbnail (256px)
    """
    folder = Paths().md_thumb_path
    return send_file_or_fallback(folder, path.imgpath, thumbnail_fallback(query), pathhash=query.pathhash)


# ARTISTS
@api.get("/artist/<imgpath>")
def send_lg_artist_image(path: ImagePath):
    """
    Get large artist image (500 x 500)
    """
    folder = Paths().lg_artist_img_path
    return send_file_or_fallback(str(folder), path.imgpath, "artist.webp")


@api.get("/artist/small/<imgpath>")
def send_sm_artist_image(path: ImagePath):
    """
    Get small artist image (128)
    """
    folder = Paths().sm_artist_img_path
    return send_file_or_fallback(str(folder), path.imgpath, "artist.webp")


@api.get("/artist/medium/<imgpath>")
def send_md_artist_image(path: ImagePath):
    """
    Get medium artist image (256px)
    """
    folder = Paths().md_artist_img_path
    return send_file_or_fallback(folder, path.imgpath, "artist.webp")


# PLAYLISTS
class PlaylistImagePath(BaseModel):
    imgpath: str = Field(
        description="The image path",
        example="1.webp",
    )


@api.get("/playlist/<imgpath>")
def send_playlist_image(path: PlaylistImagePath):
    """
    Get playlist image

    Images are constructed as '{playlist_id}.webp'
    """
    folder = Paths().playlist_img_path
    return send_file_or_fallback(folder, path.imgpath, "playlist.svg")


@api.get("/user/<imgpath>")
def send_user_image(path: ImagePath):
    """
    Get a user's profile image

    Images are constructed as '{user_id}{random}.webp'. A missing file returns
    404 (rather than a generic default) so the client falls back to its own
    generated avatar — consistent with users who never set a picture.
    """
    folder = Paths().user_img_path
    fpath = Path(folder) / path.imgpath

    if fpath.exists():
        return send_from_directory(folder, path.imgpath)

    return "", 404
