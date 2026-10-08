"""A cover of any shape gives thumbnails, or a clean "no", never an exception (#391).

The thumbnails keep the cover's aspect ratio at a fixed width. A banner like
2000x1 came out 0 pixels high at the small sizes, and `resize` raised
ValueError, which nothing caught: the album was retried on every scan, and in
`get_image` the exception went on up. A very tall cover (1x2000) went the other
way: at 1024 wide it asked for a 2 048 000 pixel high image.
"""

from io import BytesIO

import pytest
from PIL import Image


@pytest.fixture()
def thumbs(monkeypatch):
    from aivinnet.lib import taglib
    from aivinnet.settings import Defaults, Paths

    paths = Paths()
    folders = [paths.lg_thumb_path, paths.sm_thumb_path, paths.xsm_thumb_path, paths.md_thumb_path]
    for folder in folders:
        folder.mkdir(parents=True, exist_ok=True)

    def extract(width, height, name):
        buf = BytesIO()
        Image.new("RGB", (width, height), "red").save(buf, "PNG")
        monkeypatch.setattr(taglib, "parse_album_art", lambda _path: buf.getvalue())
        ok = taglib.extract_thumb("/music/x.mp3", f"{name}.webp", overwrite=True, paths=paths)
        sizes = []
        for folder in folders:
            with Image.open(folder / f"{name}.webp") as img:
                sizes.append(img.size)
        return ok, sizes

    return extract, Defaults


@pytest.mark.parametrize(("width", "height"), [(2000, 1), (1000, 10)])
def test_a_banner_cover_still_gives_every_thumbnail(thumbs, width, height):
    extract, _defaults = thumbs

    ok, sizes = extract(width, height, f"banner{width}")

    assert ok is True
    assert all(w >= 1 and h >= 1 for w, h in sizes)


def test_a_very_tall_cover_is_held_to_a_sane_height(thumbs):
    extract, defaults = thumbs

    ok, sizes = extract(1, 2000, "tall")

    assert ok is True
    largest = max(h for _w, h in sizes)
    assert largest <= 4 * defaults.LG_THUMB_SIZE
