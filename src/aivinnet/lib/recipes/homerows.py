"""
Routines for the personal homepage rows "Rediscover", "On this day",
"Because you listened to …", "On repeat", "Never played", "Your <weekday>
<evenings>", "Artists you might like" and "Forgotten favorites". The rules
themselves live in `lib/home/homerows.py` and `lib/home/discover.py`.

Scheduled by `crons/__init__.py` (`schedule.every(cls.hours)`), deliberately
NOT as `CronJob` subclasses: importing `crons.cron` runs `crons/__init__`,
which imports this module — any import of this module that does not come from
the cron package would then hit a half-initialized module (circular import).

All are per user and purely local (scrobbles + own library).
"""

import logging

import pendulum

from aivinnet.db.userdata import PlaylistTable, ScrobbleTable
from aivinnet.lib.home.create_items import create_items
from aivinnet.lib.home.discover import (
    REPEAT_BASELINE_WEEKS,
    REPEAT_DAYS,
    SLOT_DAYS,
    AlbumFacts,
    TrackFacts,
    because_item,
    for_this_time_item,
    forgotten_favorite_item,
    never_played_item,
    on_repeat_item,
    pick_seed_artist,
    playlist_neighbour_item,
    rank_because,
    rank_for_this_time,
    rank_forgotten_favorites,
    rank_never_played,
    rank_on_repeat,
    rank_playlist_neighbours,
    slot_title,
    time_slot,
)
from aivinnet.lib.home.homerows import (
    ROW_LIMIT,
    on_this_day_window,
    rank_rediscover,
    rediscover_item,
)
from aivinnet.lib.placeholder_artists import PLACEHOLDER_ARTIST_HASHES, PLACEHOLDER_ARTIST_NAMES
from aivinnet.lib.recipes import HomepageRoutine
from aivinnet.lib.recipes.continuelistening import all_userids
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.homepage import HomepageStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.hashing import create_hash

log = logging.getLogger(__name__)

# The placeholders minus "Various Artists": untagged files ("Unknown") are no
# album to recommend, a compilation is.
UNKNOWN_ARTISTS = frozenset(
    create_hash(name, decode=True) for name in PLACEHOLDER_ARTIST_NAMES if name != "various artists"
)


def _stopping() -> bool:
    # Imported here, not at the top: `crons` imports this module (see above).
    from aivinnet.crons import cron_stopping

    return cron_stopping()


class Rediscover(HomepageRoutine):
    """
    "Rediscover": albums played a lot, but not lately. Daily; reads the user's
    whole history, so it only ever runs in the cron thread.
    """

    hours = 24
    store_key = "rediscover"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now().timestamp()

        def album_of(trackhash: str) -> str | None:
            facts = track_facts(trackhash)
            return facts.albumhash if facts else None

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = ScrobbleTable.get_all(0, None, userid=userid)
            ranked = rank_rediscover(scrobbles, album_of, now)

            if not ranked:
                log.info("rediscover: nothing qualifies for user %s", userid)

            HomepageStore.entries[self.store_key].items[userid] = [rediscover_item(*r) for r in ranked]


class OnThisDay(HomepageRoutine):
    """
    "On this day": what the user played on this calendar date one year ago,
    grouped like "Recently played". Hourly, so the row turns over shortly
    after midnight; one day of scrobbles per user is a small read.
    """

    hours = 1
    store_key = "on_this_day"

    @property
    def is_valid(self):
        return True

    def run(self):
        start, end, label = on_this_day_window()
        entry = HomepageStore.entries[self.store_key]
        entry.description = label

        for userid in all_userids():
            scrobbles = list(ScrobbleTable.get_all_in_period(start, end, userid))
            entry.items[userid] = create_items(scrobbles, ROW_LIMIT, userid) if scrobbles else []


def track_facts(trackhash: str) -> TrackFacts | None:
    """A scrobbled track as the `discover` rules see it; None if it left the library."""
    entry = TrackStore.trackhashmap.get(trackhash)
    if entry is None or not entry.tracks:
        return None

    track = entry.tracks[0]
    if track.albumhash not in AlbumStore.albummap:
        return None

    return TrackFacts(
        albumhash=track.albumhash,
        artists=tuple(a["artisthash"] for a in track.albumartists),
        genres=tuple(track.genrehashes),
        other_albums=tuple({t.albumhash for t in entry.tracks[1:]} - {track.albumhash}),
        track_artists=tuple(a["artisthash"] for a in track.artists),
    )


class BecauseYouListened(HomepageRoutine):
    """
    "Because you listened to <artist>": albums by other artists that the user
    plays in the same sessions as the artist they played most this week.
    Reads the whole history; every 6 hours, so the seed follows the week.
    """

    hours = 6
    store_key = "because_you_listened"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now().timestamp()
        entry = HomepageStore.entries[self.store_key]

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            seed = pick_seed_artist(scrobbles, track_facts, now, skip=PLACEHOLDER_ARTIST_HASHES.__contains__)
            artist = ArtistStore.artistmap.get(seed) if seed else None

            if artist is None:
                log.info("because-you-listened: no seed artist in the last 30 days for user %s", userid)
                entry.items[userid] = []
                entry.meta.pop(userid, None)
                continue

            ranked = rank_because(scrobbles, track_facts, artist.artist.artisthash, now, UNKNOWN_ARTISTS.__contains__)
            if not ranked:
                log.info("because-you-listened: nothing played with %s for user %s", artist.artist.name, userid)

            entry.items[userid] = [because_item(*r) for r in ranked]
            entry.meta[userid] = {
                "title": f"Because you listened to {artist.artist.name}",
                "url": f"/artists/{artist.artist.artisthash}",
            }


class OnRepeat(HomepageRoutine):
    """
    "On repeat": tracks played much more this week than in the 8 weeks before.
    Hourly; reads 9 weeks of scrobbles per user.
    """

    hours = 1
    store_key = "on_repeat"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now().timestamp()
        start = int(now) - (REPEAT_DAYS + REPEAT_BASELINE_WEEKS * 7) * 86400

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all_in_period(start, int(now), userid))
            ranked = rank_on_repeat(scrobbles, track_facts, now)

            if not ranked:
                log.info("on-repeat: nothing played more than usual for user %s", userid)

            HomepageStore.entries[self.store_key].items[userid] = [on_repeat_item(*r) for r in ranked]


class NeverPlayed(HomepageRoutine):
    """
    "Never played": albums of the library the user has not played a single
    track of, nearest to their taste first, re-drawn daily. Every 6 hours, so
    an album played from the row leaves it the same day.
    """

    hours = 6
    store_key = "never_played"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now()
        day = now.date().toordinal()
        albums = [
            AlbumFacts(
                albumhash=a.album.albumhash,
                artists=tuple(x["artisthash"] for x in a.album.albumartists),
                genres=tuple(a.album.genrehashes),
                created=a.album.created_date or 0,
            )
            for a in AlbumStore.albummap.values()
            if not all(x["artisthash"] in UNKNOWN_ARTISTS for x in a.album.albumartists)
        ]
        genre_names = {g["genrehash"]: g["name"] for a in AlbumStore.albummap.values() for g in (a.album.genres or [])}

        def reason(artisthash: str | None, genrehash: str | None) -> str | None:
            artist = ArtistStore.artistmap.get(artisthash) if artisthash else None
            if artist is not None:
                return f"you play {artist.artist.name}"

            return genre_names.get(genrehash) if genrehash else None

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            ranked = rank_never_played(scrobbles, track_facts, albums, day)

            if ranked is None:
                log.info("never-played: user %s has too short a history for this row", userid)
            elif not ranked:
                log.info("never-played: user %s has played every album", userid)

            HomepageStore.entries[self.store_key].items[userid] = [
                never_played_item(albumhash, reason(artisthash, genrehash))
                for albumhash, artisthash, genrehash in ranked or []
            ]


class ForThisTime(HomepageRoutine):
    """
    "Your weekday evenings": albums the user plays at this time of the week
    more than at others. Hourly, so the row follows the clock; the title is
    the same for every user (server time, like "On this day").
    """

    hours = 1
    # At the top of every hour, not every hour from the start: the bands
    # change on the hour, and a job at :40 kept "afternoons" until 17:40.
    on_the_hour = True
    store_key = "for_this_time"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now()
        title = slot_title(time_slot(now))
        start = int(now.timestamp()) - SLOT_DAYS * 86400
        items: dict[int, list] = {}

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all_in_period(start, int(now.timestamp()), userid))
            ranked = rank_for_this_time(
                scrobbles,
                track_facts,
                now,
                exclude=UNKNOWN_ARTISTS.__contains__,
                uncapped=PLACEHOLDER_ARTIST_HASHES.__contains__,
            )

            if not ranked:
                log.info("for-this-time: no album stands out in %s for user %s", title.lower(), userid)

            items[userid] = [for_this_time_item(*r) for r in ranked]

        # Title and items change together: set one by one, a reader between
        # them saw the new slot's name over the old slot's albums.
        entry = HomepageStore.entries[self.store_key]
        entry.title = title
        entry.items = items


class ArtistsYouMightLike(HomepageRoutine):
    """
    "Artists you might like": artists in the user's own playlists next to the
    ones they play most, which they hardly play themselves. Every 6 hours.
    """

    hours = 6
    store_key = "artists_you_might_like"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now().timestamp()
        playlists: dict[int, list[list[str]]] = {}
        for playlist in PlaylistTable.get_all(current_user=False):
            playlists.setdefault(playlist.userid, []).append(playlist.trackhashes)

        for userid in all_userids():
            if _stopping():
                return

            if not playlists.get(userid):
                log.info("artists-you-might-like: user %s has no playlists", userid)
                HomepageStore.entries[self.store_key].items[userid] = []
                continue

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            # Artists without a page are left out BEFORE the row is cut to
            # its length, so the next ones fill their places.
            ranked = rank_playlist_neighbours(
                scrobbles,
                track_facts,
                playlists[userid],
                now,
                skip=lambda a: a in PLACEHOLDER_ARTIST_HASHES or a not in ArtistStore.artistmap,
            )

            if not ranked:
                log.info("artists-you-might-like: nothing new next to the top artists of user %s", userid)

            HomepageStore.entries[self.store_key].items[userid] = [playlist_neighbour_item(*r) for r in ranked]


class ForgottenFavorites(HomepageRoutine):
    """
    "Forgotten favorites": favourite tracks not played for two months. The
    favourites come from the RAM store (`fav_userids`), filled at startup and
    kept current by every (un)favourite. Every 6 hours.
    """

    hours = 6
    store_key = "forgotten_favorites"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now().timestamp()
        favorites: dict[int, list[str]] = {}
        # A copy: a scan or tag edit on another thread changes the map meanwhile.
        for trackhash, group in list(TrackStore.trackhashmap.items()):
            if not group.tracks:
                continue
            for userid in group.tracks[0].fav_userids:
                favorites.setdefault(userid, []).append(trackhash)

        for userid in all_userids():
            if _stopping():
                return

            if not favorites.get(userid):
                HomepageStore.entries[self.store_key].items[userid] = []
                log.info("forgotten-favorites: user %s has no favourite tracks", userid)
                continue

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            ranked = rank_forgotten_favorites(favorites[userid], scrobbles, track_facts, now)

            if not ranked:
                log.info("forgotten-favorites: user %s played every favourite lately", userid)

            HomepageStore.entries[self.store_key].items[userid] = [forgotten_favorite_item(*r) for r in ranked]
