from aivinnet.db.userdata import CollectionTable
from aivinnet.lib.pagelib import recover_page_items
from aivinnet.store.homepageentries import (
    GenericRecoverableEntry,
    HomepageEntry,
    PersonalTitleEntry,
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
        # Titled per user by the routine: "Because you listened to <artist>".
        "because_you_listened": PersonalTitleEntry(
            title="Because you listened",
            description="Often played in the same sessions",
        ),
        "on_repeat": GenericRecoverableEntry(
            title="On repeat",
            description="Played much more this week than usual",
        ),
        "recently_played": RecentlyPlayedHomepageEntry(
            title="Recently played",
        ),
        "never_played": GenericRecoverableEntry(
            title="Never played",
            description="In your library, not played yet",
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
    ORDER_BEFORE_PAGES = (
        "continue_listening",
        "because_you_listened",
        "on_repeat",
        "recently_played",
        "never_played",
        "rediscover",
        "on_this_day",
    )
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
