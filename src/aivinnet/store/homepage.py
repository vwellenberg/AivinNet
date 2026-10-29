from aivinnet.db.userdata import CollectionTable, NotInterestedTable, UserTable
from aivinnet.lib import first_play_cache
from aivinnet.lib.home.discover import NEVER_CHIP_MIN
from aivinnet.lib.home.layout import COLLECTIONS, Layout, make_layout
from aivinnet.lib.pagelib import recover_page_items
from aivinnet.lib.recipes import records
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

# The rows whose cards can be marked "Not interested" (#531), and what kind
# of card they hold. Their routines leave marked items out when they run; Home
# also filters at serve time, so a mark (and its undo) shows at once.
NOT_INTERESTED_ROWS = {"never_played": "album", "artists_you_might_like": "artist"}


def _card_hash(card: dict) -> str | None:
    item = card.get("item") or {}
    return item.get("albumhash") if card.get("type") == "album" else item.get("artisthash")


def _without(cards: list[dict], hashes: set[str]) -> list[dict]:
    return [card for card in cards if _card_hash(card) not in hashes]


def _stored_hashes(entry: HomepageEntry, userid: int) -> set[str]:
    """The hashes a row holds for a user, its chips' included (before recovery)."""
    items = list(getattr(entry, "items", {}).get(userid, []))
    for chip in getattr(entry, "chips", {}).get(userid, []):
        items += chip["items"]
    return {item["hash"] for item in items}


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
        # Track cards by the routine (#528): "Play all" plays playlist "deepcuts".
        "deep_cuts": GenericRecoverableEntry(
            title="Deep cuts",
            description="Tracks of your favourite artists you have never played",
            playlist="deepcuts",
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
        # Per user: the cards, and the songs never played of them, album after
        # album, for "Play the rest" (playlist "almostcomplete", #529).
        "almost_complete": PlayableEntry(
            title="Almost complete",
            description="A few songs left on albums you have mostly heard",
            playlist="almostcomplete",
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
        Drop a deleted user's cached layout and first plays (the NEW stamps of
        "Recently added", #533). SQLite hands the id of the newest user to the
        next one created after its deletion, and both would still be cached
        under it.
        """
        cls.layouts.pop(userid, None)
        first_play_cache.forget(userid)
        records.forget(userid)

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
    def _row(cls, key: str, userid: int, limit: int, marked: dict[str, set[str]]) -> list[dict]:
        entry = cls.entries[key]
        kind = NOT_INTERESTED_ROWS.get(key)
        # Only the marks still in the row's stored items: the routine leaves
        # out what was marked before it ran (#531).
        skip = marked.get(kind, set()) & _stored_hashes(entry, userid) if kind else set()
        # Asked for as many more as are marked, so the row stays full until
        # its routine runs again and leaves them out itself.
        row = entry.get_items(userid, limit + len(skip))

        if kind:
            # The client offers "Not interested" on the rows that say so.
            row["markable"] = kind
        if skip:
            row["items"] = _without(row["items"], skip)[:limit]
            # A chip left with one album is no choice (`NEVER_CHIP_MIN`, as
            # the routine decides), and one left with none leads nowhere.
            chips = [{**c, "items": _without(c["items"], skip)[:limit]} for c in row.get("chips", [])]
            chips = [c for c in chips if len(c["items"]) >= NEVER_CHIP_MIN]
            if chips:
                row["chips"] = chips
            else:
                row.pop("chips", None)

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
        visible = cls.get_layout(userid).visible
        # Read on every Home, not cached: one small indexed table, and an Undo
        # must bring the card back on the very next Home.
        marked = NotInterestedTable.hashes(userid) if any(k in NOT_INTERESTED_ROWS for k in visible) else {}
        rows: list[dict] = []

        for key in visible:
            rows += cls._collections() if key == COLLECTIONS else cls._row(key, userid, limit, marked)

        return rows
