"""
Artist pictures chosen by hand: upload one, or take one away.

A hand-made choice has to outlive the two automatic mechanisms that also write
to the artist image folder, or it silently reverts:

- the online lookup (`artistlib.CheckArtistImages`), which fills in any artist
  without a file — so a removed picture would come back on the next scan;
- the placeholder purge (`placeholder_artists`), which deletes the picture of
  "Unknown" on every start — so a picture set for "Unknown" on purpose would be
  gone after the next restart.

Both check for a marker file, `<artist images>/user-set/<artisthash>`, written
by an upload AND by a removal: either way the owner has decided, and "no
picture" is as much a decision as a picture.
"""

import logging
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from aivinnet.settings import Defaults, Paths

log = logging.getLogger(__name__)

# The size the online lookup stores as "large" — Deezer's picture_big. A phone
# photo is several thousand pixels; keeping it would make every artist page
# download megabytes for a 500px frame.
LG_ARTIST_IMG_SIZE = 500


def user_set_dir() -> Path:
    return Paths().artist_img_path / "user-set"


def is_user_set(artisthash: str) -> bool:
    return (user_set_dir() / artisthash).exists()


def _image_paths(artisthash: str) -> list[tuple[Path, int]]:
    paths = Paths()
    filename = f"{artisthash}.webp"

    return [
        (paths.lg_artist_img_path / filename, LG_ARTIST_IMG_SIZE),
        (paths.md_artist_img_path / filename, Defaults.MD_ARTIST_IMG_SIZE),
        (paths.sm_artist_img_path / filename, Defaults.SM_ARTIST_IMG_SIZE),
    ]


def _mark_user_set(artisthash: str) -> None:
    folder = user_set_dir()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / artisthash).touch()


def save_artist_image_bytes(artisthash: str, image_bytes: bytes) -> str | None:
    """
    Save an image as the artist's picture in all three sizes.

    Cropped to a centred square: every place that shows an artist frames the
    picture as a disc or a square, and a portrait photo scaled into one would
    be squashed or cut off somewhere arbitrary.

    Returns the filename ('<artisthash>.webp'), or None if the bytes are not an
    image.
    """
    try:
        img = Image.open(BytesIO(image_bytes))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        log.warning("Artist image for %s could not be decoded: %s", artisthash, e)
        return None

    try:
        # Phone photos store their rotation as EXIF; without this they come
        # out lying on their side.
        img = ImageOps.exif_transpose(img)
        # webp cannot hold every mode (P, CMYK, I;16 …); RGBA keeps transparency.
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

        side = min(img.size)
        square = ImageOps.fit(img, (side, side), Image.Resampling.LANCZOS)

        for path, size in _image_paths(artisthash):
            path.parent.mkdir(parents=True, exist_ok=True)
            square.resize((min(size, side), min(size, side)), Image.Resampling.LANCZOS).save(path, "webp")
    except (OSError, ValueError) as e:
        log.warning("Saving artist image for %s failed: %s", artisthash, e)
        return None
    finally:
        img.close()

    _mark_user_set(artisthash)
    return f"{artisthash}.webp"


def remove_artist_image(artisthash: str) -> None:
    """
    Remove the artist's picture; the image server then falls back to the
    generic artist icon. Remembered, so no scan puts a picture back.
    """
    for path, _ in _image_paths(artisthash):
        path.unlink(missing_ok=True)

    _mark_user_set(artisthash)


def refresh_artist_color(artisthash: str) -> str:
    """
    Recompute the artist's accent colour from its current picture and store it.

    The colour pass at scan time only fills in artists that have NO colour, so
    without this the artist page would keep the tint of the picture it had
    before. Returns the new colour ('' when there is no picture).
    """
    # Imported here: the DB and store chain is heavy, and the save/remove
    # helpers above are useful without it.
    from aivinnet.db.userdata import LibDataTable
    from aivinnet.lib.colorlib import process_color
    from aivinnet.store.artists import ArtistStore

    colors = process_color(artisthash, is_album=False)
    color = colors[0] if colors else ""

    if LibDataTable.find_one(artisthash, type="artist") is None:
        LibDataTable.insert_one({"itemhash": "artist" + artisthash, "color": color, "itemtype": "artist"})
    else:
        LibDataTable.update_one("artist" + artisthash, {"color": color})

    entry = ArtistStore.artistmap.get(artisthash)
    if entry:
        entry.set_color(color)

    return color
