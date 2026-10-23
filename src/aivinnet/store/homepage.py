from aivinnet.db.userdata import CollectionTable, UserTable
from aivinnet.lib.home.layout import COLLECTIONS, Layout, make_layout
from aivinnet.lib.pagelib import recover_page_items
from aivinnet.models.user import HOME_LAYOUT_KEY
from aivinnet.store.homepageentries import (
    ChipsEntry,
    GenericRecoverableEntry,
    HomepageEntry,
    MixesEntry,
    PlayableEntry,
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
        # Playlist cards "Mix 1" … from the user's own sessions (#526).
        "your_mixes": MixesEntry(
            title="Your mixes",
            description="Made from what you play together",
        ),
        # Titled per user by the routine: "Because you listened to <artist>";
        # one track per album for "Play mix" (playlist "becauseyoulistened").
        "because_you_listened": PlayableEntry(
            title="Because you listened",
            description="Often played in the same sessions",
            playlist="becauseyoulistened",
        ),
        "on_repeat": GenericRecoverableEntry(
            title="On repeat",
            description="Played much more this week than usual",
            playlist="onrepeat",
        ),
        "recently_played": RecentlyPlayedHomepageEntry(
            title="Recently played",
        ),
        # Titled by the routine after the time slot: "Your weekday evenings".
        "for_this_time": GenericRecoverableEntry(
            title="For this time",
            description="What you play at this time more than at others",
        ),
        # Genre chips by the routine: the user's most played genres.
        "never_played": ChipsEntry(
            title="Never played",
            description="In your library, not played yet",
        ),
        "artists_you_might_like": GenericRecoverableEntry(
            title="Artists you might like",
            description="In your playlists next to the ones you play most",
        ),
        "forgotten_favorites": GenericRecoverableEntry(
            title="Forgotten favorites",
            description="Favorites you have not played in a while",
            playlist="forgottenfavorites",
        ),
        "rediscover": GenericRecoverableEntry(
            title="Rediscover",
            description="You played these a lot — not lately",
        ),
        # Per user: the date and a summary of that day as the description, and
        # the day's tracks for "Play that day" (playlist "onthisday").
        "on_this_day": PlayableEntry(
            title="On this day",
            description="",
            playlist="onthisday",
        ),
        "recently_added": RecentlyAddedHomepageEntry(
            title="Recently added",
            description="New music added to your library",
        ),
    }

    # Each user's Home layout (#532: rows hidden and reordered), read from
    # `UserTable.extra` on the first Home of a process and kept here: Home is
    # asked for on every visit, the layout changes only from the settings.
    # The default order and the rules live in `lib/home/layout.py`.
    layouts: dict[int, Layout] = {}

    @classmethod
    def forget_user(cls, userid: int):
        """
        Drop a deleted user's cached layout. SQLite hands the id of the newest
        user to the next one created after its deletion, and the layout would
        still be cached under it.
        """
        cls.layouts.pop(userid, None)

    @classmethod
    def add_new_user(cls, userid: int):
        """
        Give a freshly created user an (empty) slot in every per-user row, and
        no cached layout (see `forget_user`: this covers a deletion that went
        around it).
        """
        cls.forget_user(userid)
        for entry in cls.entries.values():
            if isinstance(entry, RecentlyPlayedHomepageEntry) and not isinstance(entry, RecentlyAddedHomepageEntry):
                entry.add_new_user(userid)

    @classmethod
    def get_layout(cls, userid: int) -> Layout:
        """The user's Home layout, normalized against today's rows."""
        layout = cls.layouts.get(userid)
        if layout is None:
            saved = UserTable.get_extra(userid).get(HOME_LAYOUT_KEY)
            if not isinstance(saved, dict):
                saved = {}
            # Anything but a list (a hand edit, a later format) is no layout:
            # read as nothing saved, not as a 500 on every Home.
            order, hidden = (v if isinstance(v, list) else None for v in (saved.get("order"), saved.get("hidden")))
            layout = make_layout(order, hidden)
            cls.layouts[userid] = layout

        return layout

    @classmethod
    def set_layout(cls, userid: int, order: list[str], hidden: list[str]) -> Layout:
        """Store a layout the user chose; what is kept is its normalized form."""
        layout = make_layout(order, hidden)
        UserTable.set_extra(userid, HOME_LAYOUT_KEY, {"order": list(layout.order), "hidden": sorted(layout.hidden)})
        cls.layouts[userid] = layout
        return layout

    @classmethod
    def row_names(cls) -> dict[str, tuple[str, str]]:
        """`(title, description)` of every row, for the settings."""
        names = {key: (entry.name, entry.description) for key, entry in cls.entries.items()}
        names[COLLECTIONS] = ("Collections", "The collection pages you made")
        return names

    @classmethod
    def _row(cls, key: str, userid: int, limit: int) -> list[dict]:
        row = cls.entries[key].get_items(userid, limit)

        # A row with nothing to show is left out, not sent empty.
        return [{key: row}] if row["items"] else []

    @classmethod
    def _collections(cls) -> list[dict]:
        pagedata = []

        for page in CollectionTable.get_all():
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

        return pagedata

    @classmethod
    def get_homepage_items(cls, limit: int):
        """
        A list of {row name: row}, in the user's order. A hidden row is not
        assembled at all (its routine still runs in the background: it is
        per row, not per user).
        """
        userid = get_current_userid()
        rows: list[dict] = []

        for key in cls.get_layout(userid).visible:
            rows += cls._collections() if key == COLLECTIONS else cls._row(key, userid, limit)

        return rows
