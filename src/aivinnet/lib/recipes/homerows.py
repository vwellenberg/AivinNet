"""
Routines for the personal homepage rows "Rediscover", "On this day",
"Because you listened to …", "On repeat", "Never played", "Your <weekday>
<evenings>", "Artists you might like", "Deep cuts", "Forgotten favorites",
"Your mixes" and "Almost complete". The rules
themselves live in `lib/home/homerows.py` and `lib/home/discover.py`.

Scheduled by `crons/__init__.py` (`schedule.every(cls.hours)`), deliberately
NOT as `CronJob` subclasses: importing `crons.cron` runs `crons/__init__`,
which imports this module — any import of this module that does not come from
the cron package would then hit a half-initialized module (circular import).

All are per user and purely local (scrobbles + own library).
"""

import logging

import pendulum
from pendulum.tz import local_timezone

from aivinnet.db.userdata import NotInterestedTable, PlaylistTable, ScrobbleTable
from aivinnet.lib.albumslib import sort_by_track_no
from aivinnet.lib.first_play_cache import first_plays_of
from aivinnet.lib.home.almost_complete import (
    AlbumTracks,
    after_play,
    almost_complete_item,
    rank_almost_complete,
    rest_of,
)
from aivinnet.lib.home.discover import (
    DEEP_CUT_TOP_DAYS,
    FAVORITE_PLAYLIST_LIMIT,
    ON_THIS_DAY_YEARS,
    REPEAT_BASELINE_WEEKS,
    REPEAT_DAYS,
    SLOT_DAYS,
    AlbumFacts,
    TrackFacts,
    because_item,
    because_mix,
    day_playlist,
    day_summary,
    deep_cut_item,
    discovered_on_this_day,
    for_this_time_item,
    forgotten_favorite_item,
    never_played_chips,
    never_played_item,
    on_repeat_item,
    on_this_day_item,
    pick_seed_artist,
    playlist_neighbour_item,
    rank_because,
    rank_deep_cuts,
    rank_for_this_time,
    rank_forgotten_favorites,
    rank_never_played,
    rank_on_repeat,
    rank_on_this_day,
    rank_playlist_neighbours,
    score_unplayed,
    slot_title,
    time_slot,
)
from aivinnet.lib.home.homerows import (
    on_this_day_window,
    rank_rediscover,
    rediscover_item,
)
from aivinnet.lib.home.mixes import MIX_NAMED_ARTISTS, MIX_PLAYLIST_IDS, build_mixes, place_mixes
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
        now = pendulum.now()
        tz = local_timezone()
        entry = HomepageStore.entries[self.store_key]
        windows = [(now.year - years, *on_this_day_window(now, years)) for years in range(1, ON_THIS_DAY_YEARS + 1)]

        def name_of(artisthash: str) -> str | None:
            # "mostly Various Artists" says nothing about the day.
            if artisthash in PLACEHOLDER_ARTIST_HASHES:
                return None
            artist = ArtistStore.artistmap.get(artisthash)
            return artist.artist.name if artist else None

        for userid in all_userids():
            if _stopping():
                return

            # One small read per year: the same calendar day, newest first.
            days = []
            for year, start, end, label in windows:
                plays = list(ScrobbleTable.get_all_in_period(start, end, userid))
                if plays:
                    days.append((year, label, plays))

            # Which album was first heard on one of these days (#534): its card
            # shows that year. Only asked when there is a day to show; the
            # first plays are cached per user until their next play.
            discovered = (
                discovered_on_this_day(
                    first_plays_of(userid).albums, [(year, start, end) for year, start, end, _ in windows]
                )
                if days
                else {}
            )
            ranked = rank_on_this_day([(year, plays) for year, _, plays in days], track_facts, discovered=discovered)

            # The newest year whose plays are still in the library is the day
            # "Play that day" plays and the summary describes; older years only
            # add their albums. Not simply the newest year with plays: after a
            # retag its tracks may all be gone, and the button would play nothing.
            playable = next(
                ((label, plays, tracks) for _, label, plays in days if (tracks := day_playlist(plays, track_facts))),
                None,
            )

            if not days:
                log.info(
                    "on-this-day: no plays on this day in the last %d years for user %s", ON_THIS_DAY_YEARS, userid
                )
            elif playable is None:
                log.info("on-this-day: plays on this day, but none still in the library for user %s", userid)

            # Description and playlist first, the cards last: a reader between
            # them would see the new cards under the old day's text.
            if playable is None:
                entry.meta.pop(userid, None)
                entry.trackhashes.pop(userid, None)
            else:
                label, plays, tracks = playable
                summary = day_summary(plays, track_facts, name_of, tz)
                entry.meta[userid] = {
                    "description": f"{label} · {summary}" if summary else label,
                    "playlist_name": f"On this day · {label}",
                }
                entry.trackhashes[userid] = tracks

            entry.items[userid] = [
                on_this_day_item(albumhash, year, plays, first_heard=discovered.get(albumhash) == year)
                for albumhash, year, plays in ranked
            ]


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
                entry.trackhashes.pop(userid, None)
                continue

            ranked = rank_because(scrobbles, track_facts, artist.artist.artisthash, now, UNKNOWN_ARTISTS.__contains__)
            if not ranked:
                log.info("because-you-listened: nothing played with %s for user %s", artist.artist.name, userid)

            title = f"Because you listened to {artist.artist.name}"
            # Mix and title before the cards, like "On this day": a reader in
            # between would otherwise play the old seed's mix under new cards.
            entry.trackhashes[userid] = because_mix(scrobbles, track_facts, [a for a, _, _ in ranked])
            entry.meta[userid] = {
                "title": title,
                "url": f"/artists/{artist.artist.artisthash}",
                "playlist_name": title,
            }
            entry.items[userid] = [because_item(*r) for r in ranked]


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
        # A snapshot: this runs in the cron thread while a scan or an apply may
        # add albums to the live dict (#391).
        entries = list(AlbumStore.albummap.values())
        albums = [
            AlbumFacts(
                albumhash=a.album.albumhash,
                artists=tuple(x["artisthash"] for x in a.album.albumartists),
                # From `genres`, not `genrehashes`: the scanner stores the
                # latter as ONE space-joined string (`tagger.py`), and
                # `tuple()` of that is a tuple of characters — no genre ever
                # matched, so "Never played" never gave a genre as its reason.
                genres=tuple(g["genrehash"] for g in a.album.genres or []),
                created=a.album.created_date or 0,
            )
            for a in entries
            if not all(x["artisthash"] in UNKNOWN_ARTISTS for x in a.album.albumartists)
        ]
        genre_names = {g["genrehash"]: g["name"] for a in entries for g in (a.album.genres or [])}

        def reason(artisthash: str | None, genrehash: str | None) -> str | None:
            artist = ArtistStore.artistmap.get(artisthash) if artisthash else None
            if artist is not None:
                return f"you play {artist.artist.name}"

            return genre_names.get(genrehash) if genrehash else None

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            # What the user said "Not interested" to (#531) is no candidate,
            # for the row or its chips.
            marked = NotInterestedTable.hashes(userid).get("album", set())
            candidates = [a for a in albums if a.albumhash not in marked] if marked else albums
            # Scored once, for the row and its chips.
            unplayed = score_unplayed(scrobbles, track_facts, candidates)
            ranked = rank_never_played(scrobbles, track_facts, candidates, day, unplayed=unplayed) if unplayed else None

            if ranked is None:
                log.info("never-played: user %s has too short a history for this row", userid)
            elif not ranked:
                log.info("never-played: user %s has played every album (or marked it not interesting)", userid)

            entry = HomepageStore.entries[self.store_key]
            entry.items[userid] = [
                never_played_item(albumhash, reason(artisthash, genrehash))
                for albumhash, artisthash, genrehash in ranked or []
            ]
            entry.chips[userid] = [
                {
                    "key": genre,
                    "label": genre_names.get(genre, genre),
                    "items": [never_played_item(a, reason(artist, g)) for a, artist, g in picks],
                }
                for genre, picks in (
                    never_played_chips(scrobbles, track_facts, candidates, unplayed=unplayed) if unplayed else []
                )
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
            # Artists without a page, and those the user said "Not interested"
            # to (#531), are left out BEFORE the row is cut to its length, so
            # the next ones fill their places.
            ranked = rank_playlist_neighbours(
                scrobbles,
                track_facts,
                playlists[userid],
                now,
                skip=lambda a: a in PLACEHOLDER_ARTIST_HASHES or a not in ArtistStore.artistmap,
                exclude=NotInterestedTable.hashes(userid).get("artist", set()),
            )

            if not ranked:
                log.info("artists-you-might-like: nothing new next to the top artists of user %s", userid)

            HomepageStore.entries[self.store_key].items[userid] = [playlist_neighbour_item(*r) for r in ranked]


class DeepCuts(HomepageRoutine):
    """
    "Deep cuts": tracks of the user's top album artists (last 90 days) that the
    user has never played. Every 6 hours; reads the whole history per user, as
    "Never played" does, since a play anywhere in it takes a track off the row.
    """

    hours = 6
    store_key = "deep_cuts"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now().timestamp()
        entry = HomepageStore.entries[self.store_key]

        def name_of(artisthash: str) -> str | None:
            artist = ArtistStore.artistmap.get(artisthash)
            return artist.artist.name if artist else None

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            result = rank_deep_cuts(
                scrobbles,
                track_facts,
                library_tracks_of,
                now,
                skip=PLACEHOLDER_ARTIST_HASHES.__contains__,
            )

            if not result.artists:
                log.info("deep-cuts: user %s has no album artist played in the last %d days", userid, DEEP_CUT_TOP_DAYS)
            elif not result.tracks:
                log.info("deep-cuts: user %s has played every track of the top artists", userid)

            items = []
            for trackhash, artisthash, _ in result.tracks:
                name = name_of(artisthash)
                items.append(deep_cut_item(trackhash, f"you play {name}" if name else None))

            entry.items[userid] = items


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
            # More than a row shows: the rest are what "Play all" plays.
            ranked = rank_forgotten_favorites(
                favorites[userid], scrobbles, track_facts, now, limit=FAVORITE_PLAYLIST_LIMIT
            )

            if not ranked:
                log.info("forgotten-favorites: user %s played every favourite lately", userid)

            HomepageStore.entries[self.store_key].items[userid] = [forgotten_favorite_item(*r) for r in ranked]


class AlmostComplete(HomepageRoutine):
    """
    "Almost complete" (#529): albums the user has heard at least 60 % of, with
    a few songs never played. The whole history counts, grouped in SQL per
    user. Every 6 hours, like the other library rows; the albums with their
    tracks in album order are built once per run, for every user.
    """

    hours = 6
    store_key = "almost_complete"

    @property
    def is_valid(self):
        return True

    def run(self):
        entry = HomepageStore.entries[self.store_key]
        albums = []
        # A copy: a scan or tag edit on another thread changes the map meanwhile.
        for albumhash, album in list(AlbumStore.albummap.items()):
            # In the order the album page plays them.
            tracks = sort_by_track_no(TrackStore.get_tracks_by_trackhashes(album.trackhashes))
            albums.append(
                AlbumTracks(
                    albumhash,
                    [t.trackhash for t in tracks],
                    tuple(a["artisthash"] for a in album.album.albumartists),
                )
            )

        for userid in all_userids():
            if _stopping():
                return

            heard = ScrobbleTable.heard_trackhashes_of(userid)
            ranked = rank_almost_complete(albums, heard, exclude=UNKNOWN_ARTISTS.__contains__) if heard else []

            if not heard:
                log.info("almost-complete: user %s has no plays yet", userid)
            elif not ranked:
                log.info("almost-complete: no album is nearly heard through for user %s", userid)

            # The playlist first, the cards last, like "On this day".
            entry.trackhashes[userid] = rest_of(ranked)
            entry.items[userid] = [almost_complete_item(a) for a in ranked]


def almost_complete_played(userid: int, trackhash: str):
    """
    Keep "Almost complete" current after a play (`after_play`), from the
    scrobble endpoint: RAM only, nothing to do unless the song was missing.
    """
    entry = HomepageStore.entries["almost_complete"]
    rest = entry.trackhashes.get(userid, [])
    if trackhash not in rest:
        return

    group = TrackStore.trackhashmap.get(trackhash)
    if group is None or not group.tracks:
        return
    albumhash = group.tracks[0].albumhash
    cards, left = after_play(entry.items.get(userid, []), rest, trackhash, albumhash)
    entry.trackhashes[userid] = left
    entry.items[userid] = cards


def library_tracks_of(artisthash: str) -> list[str]:
    """An artist's tracks in the library, for the mixes (their albums come from `track_facts`)."""
    return [track.trackhash for track in ArtistStore.get_artist_tracks(artisthash)]


class YourMixes(HomepageRoutine):
    """
    "Your mixes": playlists cut from the user's own sessions (`lib/home/mixes`).
    Every 6 hours like the other session rows; the never-played tracks in each
    mix are re-drawn once a day.
    """

    hours = 6
    store_key = "your_mixes"

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now()
        day = now.date().toordinal()
        entry = HomepageStore.entries[self.store_key]

        def name_of(artisthash: str) -> str:
            artist = ArtistStore.artistmap.get(artisthash)
            return artist.artist.name if artist else ""

        for userid in all_userids():
            if _stopping():
                return

            scrobbles = list(ScrobbleTable.get_all(0, None, userid=userid))
            mixes = build_mixes(
                scrobbles,
                track_facts,
                library_tracks_of,
                now.timestamp(),
                day,
                skip=lambda a: a in PLACEHOLDER_ARTIST_HASHES or a not in ArtistStore.artistmap,
            )

            if mixes is None:
                log.info("your-mixes: user %s has too short a history for mixes", userid)
            elif not mixes:
                log.info("your-mixes: no group of artists played together for user %s", userid)

            # A mix keeps the slot its core had last run ("mix2" stays jazz).
            previous = [slot["core"] if slot else None for slot in entry.mixes.get(userid, [])]
            slots = place_mixes(mixes or [], previous)

            # The playlists before the cards: a reader in between must not
            # open "Mix 1" and find the previous run's tracks under new names.
            entry.mixes[userid] = [
                {"name": f"Mix {i + 1}", "core": m.artists[0], "trackhashes": m.tracks} if m else None
                for i, m in enumerate(slots)
            ]
            entry.items[userid] = [
                {
                    "type": "playlist",
                    "hash": MIX_PLAYLIST_IDS[i],
                    "is_custom": True,
                    "help_text": ", ".join(n for n in map(name_of, m.artists[:MIX_NAMED_ARTISTS]) if n),
                }
                for i, m in enumerate(slots)
                if m
            ]
