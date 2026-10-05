from aivinnet.db.userdata import CollectionTable
from aivinnet.lib.pagelib import recover_page_items
from aivinnet.store.homepageentries import (
    GenericRecoverableEntry,
    HomepageEntry,
    RecentlyAddedHomepageEntry,
    RecentlyPlayedHomepageEntry,
)
from aivinnet.utils.auth import get_current_userid


class HomepageStore:
    """
    Stores the homepage items.
    """

    # INFO: map of entry names to entry objects
    entries: dict[str, HomepageEntry] = {
        "continue_listening": GenericRecoverableEntry(
            title="Continue listening",
        ),
        "recently_played": RecentlyPlayedHomepageEntry(
            title="Recently played",
        ),
        "rediscover": GenericRecoverableEntry(
            title="Rediscover",
            description="You played these a lot — not lately",
        ),
        "on_this_day": GenericRecoverableEntry(
            title="On this day",
            # Set to the date one year ago by the OnThisDay routine.
            description="",
        ),
        "recently_added": RecentlyAddedHomepageEntry(
            title="Recently added",
            description="New music added to your library",
        ),
    }

    # The order of the response, explicitly. Collection pages go between the
    # two lists; "Recently added" is pinned to the bottom.
    ORDER_BEFORE_PAGES = ("continue_listening", "recently_played", "rediscover", "on_this_day")
    ORDER_AFTER_PAGES = ("recently_added",)

    @classmethod
    def add_new_user(cls, userid: int):
        """
        Give a freshly created user an (empty) slot in every per-user row.
        """
        for entry in cls.entries.values():
            if isinstance(entry, RecentlyPlayedHomepageEntry) and not isinstance(entry, RecentlyAddedHomepageEntry):
                entry.add_new_user(userid)

    @classmethod
    def _rows(cls, keys: tuple[str, ...], userid: int, limit: int):
        rows = []

        for key in keys:
            row = cls.entries[key].get_items(userid, limit)

            # A row with nothing to show is left out, not sent empty.
            if row["items"]:
                rows.append({key: row})

        return rows

    @classmethod
    def get_homepage_items(cls, limit: int):
        # return a list of {entry name: entry items}, in display order
        userid = get_current_userid()
        pages = CollectionTable.get_all()
        pagedata = []

        for page in pages:
            pagedata.append(
                {
                    page["id"]: {
                        "id": page["id"],
                        "title": page["name"],
                        "description": page["extra"]["description"],
                        "items": recover_page_items(page["items"], for_homepage=True),
                        "url": f"collections/{page['id']}",
                    }
                }
            )

        return (
            cls._rows(cls.ORDER_BEFORE_PAGES, userid, limit)
            + pagedata
            + cls._rows(cls.ORDER_AFTER_PAGES, userid, limit)
        )
