"""The placeholder covers are an ink glyph on a TRANSPARENT tile (#395).

The web client paints the tile behind the image in the entity tint of the
active colour scheme (client/src/assets/scss/Global/cover-placeholders.scss).
That only works while the shipped files stay clear around the glyph: an opaque
tile — say, a re-exported asset in the old Memphis lavender — would cover the
scheme colour again in every scheme, and nothing would fail. (Telling a
placeholder from a real cover is NOT done by these pixels — real artwork can be
transparent too — but by the response header, see test_imgserver_fallback.py.)

In this lane because it needs Pillow, which the fast lane does not install.
"""

from pathlib import Path

import pytest
from PIL import Image

ASSETS = Path(__file__).resolve().parents[1] / "src" / "aivinnet" / "assets"
INK = (23, 23, 26)


@pytest.mark.parametrize(
    "name", ["default.webp", "track.webp", "artist.webp", "default.dense.webp", "track.dense.webp"]
)
def test_placeholder_is_an_ink_glyph_on_a_clear_tile(name):
    image = Image.open(ASSETS / name)
    assert image.mode == "RGBA", f"{name} has no alpha channel"
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    width, height = rgba.size

    # Every corner fully clear: the tile is the page's, edge to edge.
    for corner in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
        assert rgba.getpixel(corner)[3] == 0, f"{name}: corner {corner} is not transparent"

    # Mostly clear, and the glyph is there and opaque ink.
    values = list(alpha.getdata())
    clear_share = sum(1 for v in values if v == 0) / len(values)
    # The dense cut fills ~3/4 of the tile with its glyph on purpose (the
    # sidebar's 24px slot); its ring alone covers ~15%. Still far from the
    # opaque tile this guards against.
    min_clear = 0.75 if ".dense." in name else 0.9
    assert clear_share > min_clear, f"{name}: only {clear_share:.0%} of the tile is clear"
    glyph = [
        rgba.getpixel((x, y))[:3]
        for x in range(0, width, 3)
        for y in range(0, height, 3)
        if alpha.getpixel((x, y)) == 255
    ]
    assert glyph, f"{name}: no opaque glyph left"
    assert all(px == INK for px in glyph), f"{name}: the glyph is not ink"


@pytest.mark.parametrize("name", ["default", "track"])
def test_the_dense_cut_draws_a_bigger_glyph(name):
    """The dense cut exists for its proportions: the glyph has to fill more of
    the tile than the regular one, or the sidebar's 24px placeholder keeps its
    hairline strokes (user, 2026-11-16)."""

    def glyph_width(filename):
        box = Image.open(ASSETS / filename).getchannel("A").getbbox()
        assert box, f"{filename}: empty"
        return box[2] - box[0]

    regular = glyph_width(f"{name}.webp")
    dense = glyph_width(f"{name}.dense.webp")
    assert dense >= 2 * regular, f"{name}.dense.webp ({dense}px) is not much bigger than {name}.webp ({regular}px)"
