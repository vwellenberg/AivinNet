from typing import Any

from swingmusic.db.userdata import CollectionTable, MixTable
from swingmusic.lib.pagelib import recover_page_items
from swingmusic.store.homepageentries import (
    BecauseYouListenedToArtistHomepageEntry,
    GenericRecoverableEntry,
    HomepageEntry,
    MixHomepageEntry,
    RecentlyAddedHomepageEntry,
    RecentlyPlayedHomepageEntry,
)
from swingmusic.utils.auth import get_current_userid
from swingmusic.utils.mixes import latest_mix_per_artist


class HomepageStore:
    """
    Stores the homepage items.
    """

    # INFO: map of entry names to entry objects
    entries: dict[str, HomepageEntry] = {
        "recently_played": RecentlyPlayedHomepageEntry(
            title="Recently played",
        ),
        "artist_mixes": MixHomepageEntry(
            title="Artist mixes for you",
            description="Based on artists you have been listening to",
        ),
        "custom_mixes": MixHomepageEntry(
            title="Mixes for you",
            description="Because artist mixes alone aren't enough",
        ),
        "top_streamed_weekly_artists": GenericRecoverableEntry(
            title="Top artists this week",
            description="Your most played artists since Monday",
        ),
        "top_streamed_monthly_artists": GenericRecoverableEntry(
            title="Top artists this month",
            description="Your most played artists since the start of the month",
        ),
        "because_you_listened_to_artist": BecauseYouListenedToArtistHomepageEntry(
            title="",
            description="Artists similar to the artist you listened to",
        ),
        "artists_you_might_like": BecauseYouListenedToArtistHomepageEntry(
            title="Artists you might like",
            description="Artists similar to the artists you have listened to",
        ),
        "recently_added": RecentlyAddedHomepageEntry(
            title="Recently added",
            description="New music added to your library",
        ),
    }

    @classmethod
    def set_mixes(cls, items: list[Any], entrykey: str, userid: int | None = None):
        idmap = {item.id: item for item in items}
        cls.entries[entrykey].items[userid or get_current_userid()] = idmap

    @classmethod
    def load_mixes_from_db(cls):
        """
        Seed the mix entries from the database at startup.

        Without this the mix rows exist only in RAM, filled by the `mixes` cron
        — and that cron is registered with `schedule.every(12).hours`, which
        fires the FIRST time twelve hours after boot, never at boot. Every
        restart therefore blanked the mix rows on the homepage for up to half a
        day. On a server that restarts with each deploy, the rows were never
        seen at all: the data was in the database the whole time, the path to
        the homepage was simply cut.

        Runs per user, because there is no request context at startup and so no
        `get_current_userid()` to lean on.

        Cheap on purpose: `MixTable.get_all()` is one indexed query, and
        `get_track_mix` only reads TrackStore. Nothing here touches the network
        — the recommendation server is a blocking call in a single-threaded
        server, and a slow one would hold up the whole boot.
        """
        # Deferred, and NOT because of an import cycle (plugins.mixes does not
        # import this module): the plugin pulls in PIL and requests, and this
        # store is imported early and widely. Keeping that weight out of the
        # import chain of everything that touches HomepageStore is the point.
        from swingmusic.plugins.mixes import MixesPlugin

        by_user: dict[int, list[Any]] = {}

        # get_all() yields newest first, which is what latest_mix_per_artist expects.
        for mix in MixTable.get_all():
            by_user.setdefault(mix.userid, []).append(mix)

        for userid, mixes in by_user.items():
            mixes = latest_mix_per_artist(mixes)
            cls.set_mixes(mixes, entrykey="artist_mixes", userid=userid)

            custom_mixes = [m for m in (MixesPlugin.get_track_mix(mix) for mix in mixes) if m]
            cls.set_mixes(custom_mixes, entrykey="custom_mixes", userid=userid)

    @classmethod
    def get_mix(cls, mixkey: str, mixid: str):
        mix = cls.entries[mixkey].items.get(get_current_userid(), {}).get(mixid)
        return mix.to_full_dict() if mix else None

    @classmethod
    def get_homepage_items(cls, limit: int):
        # return a dict of entry name to entry items
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

        homedata = [
            {entry: cls.entries[entry].get_items(get_current_userid(), limit)}
            for entry in cls.entries
            if len(cls.entries[entry].items)
        ]

        recently_added = homedata.pop()
        return homedata + pagedata + [recently_added]

    @classmethod
    def find_mix(cls, mixid: str):
        mixentries = ["artist_mixes", "custom_mixes"]

        for entry in mixentries:
            mix = cls.entries[entry].items.get(get_current_userid(), {}).get(mixid)
            if mix:
                return mix

        return None
