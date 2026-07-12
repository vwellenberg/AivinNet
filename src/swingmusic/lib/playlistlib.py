"""
This library contains all the functions related to playlists.
"""

import hashlib
import logging
import os
import random
import string
from functools import lru_cache

from PIL import Image, ImageSequence

from swingmusic import settings
from swingmusic.models.track import Track
from swingmusic.store.albums import AlbumStore
from swingmusic.store.tracks import TrackStore

logger = logging.getLogger(__name__)


def create_thumbnail(image: Image, img_name: str) -> str:
    """
    Creates a 250 px high thumbnail from the Image.
    It will keep the aspect ratio.

    Images are saved in the playlist-img path

    :param image: Image object.
    :param img_name: Name of image.
    :return: Filename of image.
    """

    aspect_ratio = image.width / image.height
    new_w = round(250 * aspect_ratio)
    thumb = image.resize((new_w, 250), Image.Resampling.LANCZOS)

    thumb_filename = "thumb_" + img_name
    thumb_path = settings.Paths().playlist_img_path / thumb_filename

    thumb.save(thumb_path, "webp")

    return thumb_filename


def create_gif_thumbnail(image: Image, img_name: str):
    """
    Creates a 250 px high thumbnail from the provided GIF.
    Keeps the aspect ratio.

    Images are saved in the playlist-img path

    :param image: Image object.
    :param img_name: Name of image.
    :return: Filename of image.
    """
    thumb_name = "thumb_" + img_name
    thumb_path = settings.Paths().playlist_img_path / thumb_name

    frames = []
    for frame in ImageSequence.Iterator(image):
        aspect_ratio = frame.width / frame.height
        new_w = round(250 * aspect_ratio)
        thumb = frame.resize((new_w, 250), Image.Resampling.LANCZOS)

        frames.append(thumb)

    frames[0].save(thumb_path, save_all=True, append_images=frames[1:])

    return thumb_name


def save_p_image(img: Image, pid: int, content_type: str = None, filename: str = None) -> str:
    """
    Saves a playlist banner image and returns the filepath.
    """
    # img = Image.open(file)

    random_str = "".join(random.choices(string.ascii_letters + string.digits, k=5))

    if not filename:
        filename = str(pid) + str(random_str) + ".webp"

    full_img_path = settings.Paths().playlist_img_path / filename

    if content_type == "image/gif":
        frames = []

        for frame in ImageSequence.Iterator(img):
            frames.append(frame.copy())

        frames[0].save(full_img_path, save_all=True, append_images=frames[1:])
        create_gif_thumbnail(img, img_path=filename)

        return filename

    img.save(full_img_path, "webp")
    create_thumbnail(img, img_name=filename)

    return filename


def duplicate_images(images: list):
    if len(images) == 1:
        images *= 4
    elif len(images) == 2:
        images += list(reversed(images))
    elif len(images) == 3:
        images = images + images[:1]

    return images


@lru_cache(maxsize=4096)
def _file_md5(path: str, mtime_ns: int, size: int) -> str:
    """
    md5 of a file's bytes, cached per (path, mtime, size) so each cover
    thumbnail is only read once until it changes on disk.
    """
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def get_cover_content_key(image: str) -> str | None:
    """
    Returns an identity key for an album cover image based on the *content*
    of its small thumbnail file, or None when the thumbnail file is missing
    (e.g. the album has no extractable cover art).

    Different albums can carry byte-identical cover art (e.g. a compilation
    split into per-disc albums), in which case their albumhashes differ but
    the cover files are the same. Hashing the thumbnail bytes lets callers
    detect those duplicates.
    """
    path = settings.Paths().sm_thumb_path / image

    try:
        stat = os.stat(path)
        return "md5:" + _file_md5(str(path), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


# TODO: mutable var in param.
def get_first_4_images(tracks: list[Track] = [], trackhashes: list[str] = []) -> list[dict["str", str]]:
    """
    Returns images of the first 4 albums with distinct covers that appear
    in the track list, in track-list order.

    Candidate albums are deduplicated by albumhash first, then by the content
    hash of the cover thumbnail itself (see get_cover_content_key), so
    byte-identical covers on different albums don't yield duplicate images.
    Albums whose cover thumbnail is missing on disk can only render as a
    placeholder tile, so they are skipped entirely — except as a last-resort
    fallback when no album in the playlist has a cover at all.

    If fewer than 4 distinct covers exist, the list is padded with duplicates
    (see duplicate_images). Clients use that to tell "4 genuinely different
    covers" (collage-worthy) apart from padded results.

    When tracks are not passed, trackhashes need to be passed.
    Tracks are then resolved from the store.
    """
    if len(trackhashes) > 0:
        tracks = TrackStore.get_tracks_by_trackhashes(trackhashes)

    albumhashes = []
    seen_hashes = set()

    for track in tracks:
        if track.albumhash not in seen_hashes:
            seen_hashes.add(track.albumhash)
            albumhashes.append(track.albumhash)

    images = []
    seen_covers = set()
    coverless_fallback = None

    for album in AlbumStore.get_albums_by_hashes(albumhashes):
        key = get_cover_content_key(album.image)

        if key is None:
            if coverless_fallback is None:
                coverless_fallback = {"image": album.image, "color": album.color}
            continue

        if key in seen_covers:
            continue

        seen_covers.add(key)
        images.append(
            {
                "image": album.image,
                "color": album.color,
            }
        )

        if len(images) == 4:
            return images

    if not images and coverless_fallback is not None:
        images.append(coverless_fallback)

    return duplicate_images(images)


def cleanup_playlist_images() -> None:
    """
    Deletes all unlinked files in playlist-img folder.
    All files not present in the PlaylistTable will get deleted
    """
    # Import here to avoid circular import
    from swingmusic.db.userdata import PlaylistTable

    # INFO: The image folder is shared by all users, so the linked set must
    # cover ALL users' playlists — scoping to the current user would treat
    # everyone else's covers as orphans and delete them.
    playlists = PlaylistTable.get_all(current_user=False)
    linked_images = {p.image for p in playlists if p.image and p.image != "None"}

    playlist_dir = settings.Paths().playlist_img_path

    # Delete files (including thumbnails) that no playlist links anymore.
    # NOTE: The previous version compared the Path object against the set of
    # filename strings (never a member) and had the keep/delete branches
    # inverted — it deleted every LINKED image and kept the orphans.
    for file in playlist_dir.iterdir():
        if not file.is_file():
            continue

        # not stem: PlaylistTable saves with extension; thumbnails are
        # prefixed with "thumb_".
        name = file.name.removeprefix("thumb_")
        if name in linked_images:
            continue

        try:
            file.unlink(missing_ok=True)
        except OSError as e:
            logger.exception("could not delete file", exc_info=e)
