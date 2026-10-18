from dataclasses import dataclass


@dataclass
class StatItem:
    cssclass: str
    text: str
    value: str | int
    image: str | None = None
    # Set on a top-track tile so a click can play that track, not just open its album.
    trackhash: str | None = None
