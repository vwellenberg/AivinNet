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


def _png(width, height):
    buf = BytesIO()
    Image.new("RGB", (width, height), "red").save(buf, "PNG")
    return buf.getvalue()


def test_a_banner_is_cropped_not_squashed(thumbs):
    extract, _defaults = thumbs

    _ok, sizes = extract(2000, 1, "cropped")

    assert all(w / h <= 4 for w, h in sizes)


def test_a_failed_extraction_leaves_no_half_set(thumbs, monkeypatch):
    """The small thumb alone reads as done: the others would never be made."""
    from aivinnet.lib import taglib
    from aivinnet.settings import Paths

    calls = []
    real = Image.Image.resize

    def resize_twice_then_fail(self, *args, **kwargs):
        calls.append(1)
        if len(calls) > 2:
            raise ValueError("cannot resize")
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Image.Image, "resize", resize_twice_then_fail)
    monkeypatch.setattr(taglib, "parse_album_art", lambda _path: _png(600, 600))

    ok = taglib.extract_thumb("/music/x.mp3", "half.webp", overwrite=True, paths=Paths())

    assert ok is False
    paths = Paths()
    assert not any(
        (folder / "half.webp").exists()
        for folder in (paths.lg_thumb_path, paths.sm_thumb_path, paths.xsm_thumb_path, paths.md_thumb_path)
    )


def test_a_decompression_bomb_is_a_clean_no(thumbs, monkeypatch):
    """Not an OSError: it escaped and ended the whole thumbnail pass."""
    from aivinnet.lib import taglib
    from aivinnet.settings import Paths

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    monkeypatch.setattr(taglib, "parse_album_art", lambda _path: _png(600, 600))

    assert taglib.extract_thumb("/music/x.mp3", "bomb.webp", overwrite=True, paths=Paths()) is False


def test_the_scan_passes_its_paths_by_keyword(monkeypatch):
    from types import SimpleNamespace

    from aivinnet.lib import populate

    calls = []
    monkeypatch.setattr(populate, "extract_thumb", lambda *a, **k: calls.append((a, k)) or True)
    marker = object()

    populate.get_image([SimpleNamespace(filepath="/m/a.mp3", albumhash="h")], paths=marker)

    assert calls == [(("/m/a.mp3", "h.webp"), {"paths": marker})]


def test_an_artist_image_of_any_shape_is_saved(tmp_path):
    from aivinnet.lib.artistlib import DownloadImage

    for width, height in [(2000, 1), (1, 2000)]:
        targets = [(tmp_path / f"{width}-{size}.webp", size) for size in (64, 128, 512)]
        DownloadImage.save_img(Image.new("RGB", (width, height)), targets)

        for path, _size in targets:
            with Image.open(path) as img:
                assert img.width >= 1 and img.height >= 1 and max(img.size) / min(img.size) <= 4


def test_a_chosen_cover_of_any_shape_is_saved(monkeypatch):
    from aivinnet.lib import coverart

    monkeypatch.setattr(coverart, "backup_album_cover", lambda albumhash: None)

    assert coverart.save_album_cover_bytes("bannercover", _png(2000, 1)) == "bannercover.webp"
