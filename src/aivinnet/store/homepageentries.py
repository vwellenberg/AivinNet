from abc import ABC, abstractmethod
from typing import Any

from aivinnet.lib.home.recover_items import recover_items


class HomepageEntry(ABC):
    """
    Base class for all homepage entries.

    items is a dict of userid to a dict of stuff.
    """

    title: str
    description: str
    items: dict[int, Any]

    def __init__(self, title: str, description: str):
        self.title = title
        self.description = description

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

    def __init__(self, title: str, description: str = ""):
        super().__init__(title, description)
        self.items = {}

    def add_new_user(self, userid: int):
        """
        Add a new user to the homepage entry.
        """
        self.items[userid] = []

    def get_items(self, userid: int, limit: int | None = None):
        items = self.items.get(userid, [])[:limit]

        return {
            "title": self.title,
            "description": self.description,
            "items": recover_items(items),
        }


class RecentlyAddedHomepageEntry(RecentlyPlayedHomepageEntry):
    """
    A homepage entry for recently added.
    """

    def get_items(self, userid: int, limit: int | None = None):
        return super().get_items(0, limit)


class GenericRecoverableEntry(RecentlyPlayedHomepageEntry):
    """
    A homepage entry for top streamed.
    """

    # NOTE: This extends RecentlyPlayedHomepageEntry because
    # the shape of the data is the same.
    pass


class PersonalTitleEntry(GenericRecoverableEntry):
    """
    A row whose title, description and link differ per user: "Because you
    listened to Primus" names that user's seed artist. `meta[userid]` holds
    the user's `title`, `description` and `url`, each optional; without one
    the row keeps its generic text.
    """

    meta: dict[int, dict[str, str]]

    def __init__(self, title: str, description: str = ""):
        super().__init__(title, description)
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

    def __init__(self, title: str, description: str = ""):
        super().__init__(title, description)
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
