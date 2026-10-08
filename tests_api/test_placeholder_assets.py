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


@pytest.mark.parametrize("name", ["default.webp", "track.webp", "artist.webp"])
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
    assert clear_share > 0.9, f"{name}: only {clear_share:.0%} of the tile is clear"
    glyph = [
        rgba.getpixel((x, y))[:3]
        for x in range(0, width, 3)
        for y in range(0, height, 3)
        if alpha.getpixel((x, y)) == 255
    ]
    assert glyph, f"{name}: no opaque glyph left"
    assert all(px == INK for px in glyph), f"{name}: the glyph is not ink"
