"""
The logo's easter egg (#828): seven clicks on the planet and it hands over one
find — an album from "Never played" or a track from "Forgotten favorites".

Both rows are already computed per user by their routines and live in RAM
(`HomepageStore`), so a find costs no query. This module only picks; the store
says what is in the rows.
"""

import random
from collections.abc import Callable, Sequence
from typing import Any

# The rows a find comes from, and the reason the plate gives for it.
SIGNAL_ROWS: tuple[tuple[str, str], ...] = (
    ("never_played", "Never played"),
    ("forgotten_favorites", "Forgotten favorite"),
)

# The kinds of card a find can be.
FIND_TYPES = ("album", "track")

# How many cards of each row take part. The rows keep more than Home shows; a
# find may come from further down than the cards on screen.
SIGNAL_POOL = 50


def pick_find(
    pools: Sequence[tuple[str, list[dict[str, Any]]]],
    skip: str | None = None,
    choice: Callable[[list[Any]], Any] = random.choice,
) -> tuple[str, dict[str, Any]] | None:
    """
    One stored item (`{type, hash, …}`) of all `(reason, items)` pools
    together, with its reason. Only albums and tracks take part.

    Every item weighs the same, so a long row is not drowned out by a short one
    and vice versa. `skip` is the find on the plate right now ("Another"): it is
    left out while there is anything else to pick, so the button never answers
    with the same find.

    The raw items are picked, not the cards: only the one find is recovered
    (serialized), not a hundred for one plate.
    """
    candidates = [
        (reason, item)
        for reason, items in pools
        for item in items
        if item.get("type") in FIND_TYPES and item.get("hash")
    ]
    others = [c for c in candidates if c[1]["hash"] != skip]
    if others:
        candidates = others
    if not candidates:
        return None

    return choice(candidates)
