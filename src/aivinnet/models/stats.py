from dataclasses import dataclass


@dataclass
class StatItem:
    cssclass: str
    text: str
    value: str | int
    image: str | None = None
    # Set on a top-track tile so a click can play that track, not just open its album.
    trackhash: str | None = None
    # The whole answer where the tile shows only its head: the tile has two
    # lines for its value, and "56% playlists · 30% albums" needs three. The
    # client shows it as the value's tooltip.
    detail: str | None = None
