from abc import ABC, abstractmethod
from typing import Any

from aivinnet.db.userdata import ContinueDismissTable
from aivinnet.lib.first_play_cache import first_plays_of
from aivinnet.lib.home.homerows import CONTINUE_MAX_ITEMS
from aivinnet.lib.home.recover_items import recover_items


class HomepageEntry(ABC):
    """
    Base class for all homepage entries.

    items is a dict of userid to a dict of stuff.
    """

    title: str
    name: str
    description: str
    items: dict[int, Any]
    # The generated playlist (`generated_playlists`) that plays this row, if
    # any. Sent with the row, so the client's "Play all" and caption link
    # need no table of their own.
    playlist: str | None

    def __init__(self, title: str, description: str, playlist: str | None = None):
        self.title = title
        # The row's name in Settings → Home (#532). `title` is what Home shows
        # now, and a routine may rename it ("For this time" becomes "Your
        # weekday evenings"): a switch under that name would seem to hide only
        # the evening's row.
        self.name = title
        self.description = description
        self.playlist = playlist

    @abstractmethod
    def get_items(self, userid: int, limit: int | None = None):
        """
        Return usable items for the homepage.
        """
        ...


class RecentlyPlayedHomepageEntry(HomepageEntry):
    """
    A homepage entry for recently played.
    """

    items: dict[int, list[dict[str, Any]]]

    def __init__(self, title: str, description: str = "", playlist: str | None = None):
        super().__init__(title, description, playlist)
        self.items = {}

    def add_new_user(self, userid: int):
        """
        Add a new user to the homepage entry.
        """
        self.items[userid] = []

    def get_items(self, userid: int, limit: int | None = None):
        items = self.items.get(userid, [])[:limit]

        row = {
            "title": self.title,
            "description": self.description,
            "items": recover_items(items),
        }
        if self.playlist:
            row["playlist"] = self.playlist

        return row


class RecentlyAddedHomepageEntry(RecentlyPlayedHomepageEntry):
    """
    A homepage entry for recently added. The row is the same for everyone
    (kept under user 0); only the "NEW" stamp is the user's own (#533): on
    every album they have not played a single track of.
    """

    def get_items(self, userid: int, limit: int | None = None):
        row = super().get_items(0, limit)

        played = first_plays_of(userid).albums
        for card in row["items"]:
            if card["type"] == "album" and card["item"]["albumhash"] not in played:
                card["item"]["home"] = {"unheard": True}

        return row


class GenericRecoverableEntry(RecentlyPlayedHomepageEntry):
    """
    A homepage entry for top streamed.
    """

    # NOTE: This extends RecentlyPlayedHomepageEntry because
    # the shape of the data is the same.
    pass


def _dismissed(item: dict[str, Any], dismissed: dict[tuple[str, str], int]) -> bool:
    """Hidden while the last play is not newer than the dismissal (#776)."""
    at = dismissed.get((item["type"], item["hash"]))
    return at is not None and item["timestamp"] <= at


class ContinueEntry(GenericRecoverableEntry):
    """
    "Continue listening" (#776): an album or playlist the user removed with ✕
    stays out until it is played again. Every card carries `dismiss` (its type
    and hash), so the client removes it by the same key the server stores.

    Read on every Home, not cached: an undo brings the card back on the very
    next Home. Each stored item is recovered on its own, because recovery skips
    the items it cannot resolve, and a list zipped against it would misalign.
    """

    def get_items(self, userid: int, limit: int | None = None):
        dismissed = ContinueDismissTable.of_user(userid)
        # The routine keeps spares behind the row (CONTINUE_SPARE_ITEMS); Home shows
        # at most CONTINUE_MAX_ITEMS of what is left after the dismissals.
        most = CONTINUE_MAX_ITEMS if limit is None else min(limit, CONTINUE_MAX_ITEMS)
        shown = [item for item in self.items.get(userid, []) if not _dismissed(item, dismissed)][:most]

        cards = []
        for item in shown:
            for card in recover_items([item]):
                card["dismiss"] = {"type": item["type"], "hash": item["hash"]}
                cards.append(card)

        return {"title": self.title, "description": self.description, "items": cards}


class PersonalTitleEntry(GenericRecoverableEntry):
    """
    A row whose title, description and link differ per user: "Because you
    listened to Primus" names that user's seed artist. `meta[userid]` holds
    the user's `title`, `description` and `url`, each optional; without one
    the row keeps its generic text.
    """

    meta: dict[int, dict[str, str]]

    def __init__(self, title: str, description: str = "", playlist: str | None = None):
        super().__init__(title, description, playlist)
        self.meta = {}

    def get_items(self, userid: int, limit: int | None = None):
        row = super().get_items(userid, limit)
        meta = self.meta.get(userid, {})

        row["title"] = meta.get("title", self.title)
        row["description"] = meta.get("description", self.description)
        if "url" in meta:
            row["url"] = meta["url"]

        return row


class PlayableEntry(PersonalTitleEntry):
    """
    A row that can also be played as a whole ("On this day": the day in the
    order it was heard). `trackhashes[userid]` is that list, read by its
    generated playlist (`generated_playlists`).
    """

    trackhashes: dict[int, list[str]]

    def __init__(self, title: str, description: str = "", playlist: str | None = None):
        super().__init__(title, description, playlist)
        self.trackhashes = {}


class ChipsEntry(GenericRecoverableEntry):
    """
    A row with chips above it ("Never played": one per genre). Each chip
    carries its own items, so switching is instant and needs no request.
    `chips[userid]` is `[{"key", "label", "items"}]`, items stored like the
    row's own.
    """

    chips: dict[int, list[dict[str, Any]]]

    def __init__(self, title: str, description: str = ""):
        super().__init__(title, description)
        self.chips = {}

    def get_items(self, userid: int, limit: int | None = None):
        row = super().get_items(userid, limit)
        chips = [
            {"key": c["key"], "label": c["label"], "items": recover_items(c["items"][:limit])}
            for c in self.chips.get(userid, [])
        ]
        if chips:
            row["chips"] = chips

        return row


class MixesEntry(GenericRecoverableEntry):
    """
    "Your mixes": one playlist card per mix. `mixes[userid]` holds one slot per
    generated playlist "mix1" … (`onrepeat.get_mix_playlist` reads it by
    position): `{"name", "core", "trackhashes"}`, or None for a slot without a
    mix. A mix keeps its slot while its core artist does (`mixes.place_mixes`).
    """

    mixes: dict[int, list[dict[str, Any] | None]]

    def __init__(self, title: str, description: str = "", playlist: str | None = None):
        super().__init__(title, description, playlist)
        self.mixes = {}
