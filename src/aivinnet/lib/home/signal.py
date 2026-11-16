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

# How many cards of each row take part. The rows keep more than Home shows; a
# find may come from further down than the cards on screen.
SIGNAL_POOL = 50


def card_hash(card: dict[str, Any]) -> str | None:
    """The identity of a recovered album or track card; None for anything else."""
    item = card.get("item") or {}
    if card.get("type") == "album":
        return item.get("albumhash")
    if card.get("type") == "track":
        return item.get("trackhash")
    return None


def pick_find(
    pools: Sequence[tuple[str, list[dict[str, Any]]]],
    skip: str | None = None,
    choice: Callable[[list[Any]], Any] = random.choice,
) -> dict[str, Any] | None:
    """
    One card of all `(reason, cards)` pools together, as `{type, reason, item}`.

    Every card weighs the same, so a long row is not drowned out by a short one
    and vice versa. `skip` is the find on the plate right now ("Another"): it is
    left out while there is anything else to pick, so the button never answers
    with the same find.
    """
    candidates = [(reason, card) for reason, cards in pools for card in cards if card_hash(card)]
    others = [c for c in candidates if card_hash(c[1]) != skip]
    if others:
        candidates = others
    if not candidates:
        return None

    reason, card = choice(candidates)
    return {"type": card["type"], "reason": reason, "item": card["item"]}
