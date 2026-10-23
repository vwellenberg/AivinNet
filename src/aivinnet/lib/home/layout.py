"""
The Home layout of a user (#532): which rows Home shows, and in what order.

Pure rules, like the rest of `lib/home/`: the store keeps the saved layout per
user, the endpoint stores what the client sends, and these functions turn
whatever was saved into a layout that names every row exactly once. Testable
in the fast lane, strict under mypy.

A saved layout outlives the rows it was made with. A row added in a later
release is not in it, a removed one still is, so the saved order is never
taken as it stands: unknown keys go, missing ones come back where Home would
put them.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

# The collection pages (`CollectionTable`): one block of rows on Home, moved
# and hidden as one.
COLLECTIONS = "collections"

# Home's rows in their default order — what a user who never touched the
# layout sees. `HomepageStore.entries` holds one entry per key except
# COLLECTIONS.
DEFAULT_ORDER: tuple[str, ...] = (
    "continue_listening",
    "your_mixes",
    "because_you_listened",
    "on_repeat",
    "recently_played",
    "for_this_time",
    "never_played",
    "artists_you_might_like",
    "forgotten_favorites",
    "rediscover",
    "almost_complete",
    "on_this_day",
    COLLECTIONS,
    "recently_added",
)

# Rows that can be hidden but not moved. The client draws "Continue listening"
# as the cards above every row, wherever the server puts it, so an order for it
# would be a setting that does nothing.
PINNED: tuple[str, ...] = ("continue_listening",)


@dataclass(frozen=True)
class Layout:
    order: tuple[str, ...]
    hidden: frozenset[str]

    @property
    def visible(self) -> tuple[str, ...]:
        """The rows Home sends, in order. A hidden row is not even assembled."""
        return tuple(key for key in self.order if key not in self.hidden)


def normalize_order(saved: Iterable[str] | None, default: Sequence[str] = DEFAULT_ORDER) -> tuple[str, ...]:
    """
    Every row of `default` exactly once: pinned rows first, then the saved
    order of the others. A row the saved order does not know (added since)
    goes right after the row it follows by default; a key that is no row
    (removed since, or never one) is dropped.
    """
    pinned = [key for key in PINNED if key in default]
    movable = [key for key in default if key not in PINNED]

    order: list[str] = []
    for key in saved or ():
        if key in movable and key not in order:
            order.append(key)

    for i, key in enumerate(movable):
        if key in order:
            continue
        before = next((k for k in reversed(movable[:i]) if k in order), None)
        order.insert(order.index(before) + 1 if before else 0, key)

    return tuple(pinned + order)


def normalize_hidden(saved: Iterable[str] | None, default: Sequence[str] = DEFAULT_ORDER) -> frozenset[str]:
    """The saved hidden rows that are still rows."""
    return frozenset(key for key in saved or () if key in default)


def make_layout(
    order: Iterable[str] | None, hidden: Iterable[str] | None, default: Sequence[str] = DEFAULT_ORDER
) -> Layout:
    return Layout(normalize_order(order, default), normalize_hidden(hidden, default))
