"""
The genre and decade stations of the Subspace radio (#640): per user, every
6 hours, from the whole library and the user's own plays. The rules are in
`lib/home/stations.py`; the result lands in `store/stations.py`.

Scheduled by `crons/__init__.py` like the other routines, and it reads the
whole library, so it only runs in the cron thread.
"""

import logging

import pendulum

from aivinnet.db.userdata import ScrobbleTable
from aivinnet.lib.home.stations import STATION_COUNT, Station, build_stations, place_stations, station_pools
from aivinnet.lib.placeholder_artists import PLACEHOLDER_ARTIST_HASHES
from aivinnet.lib.recipes import HomepageRoutine
from aivinnet.lib.recipes.continuelistening import all_userids
from aivinnet.lib.recipes.homerows import track_facts
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.stations import StationStore
from aivinnet.store.tracks import TrackStore

log = logging.getLogger(__name__)


def _stopping() -> bool:
    # Imported here, not at the top: `crons` imports this module (see homerows.py).
    from aivinnet.crons import cron_stopping

    return cron_stopping()


def _skip(artisthash: str) -> bool:
    # As "Your mixes": placeholders and artists without a page are no group.
    return artisthash in PLACEHOLDER_ARTIST_HASHES or artisthash not in ArtistStore.artistmap


def _library_facts():
    """Every library track as the rules see it (a snapshot: a scan may add tracks meanwhile)."""
    for trackhash in list(TrackStore.trackhashmap):
        facts = track_facts(trackhash)
        if facts is not None:
            yield trackhash, facts


def _genre_names() -> dict[str, str]:
    """Genre hash → name, from the albums and the tracks of the library."""
    names: dict[str, str] = {}
    for album in list(AlbumStore.albummap.values()):
        for genre in album.album.genres or []:
            names[genre["genrehash"]] = genre["name"]
    for group in list(TrackStore.trackhashmap.values()):
        for track in group.tracks[:1]:
            if isinstance(track.genres, list):
                for genre in track.genres:
                    names.setdefault(genre["genrehash"], genre["name"])
    return names


def _slots(prefix: str, found: list[Station], previous: list[str | None]) -> dict[str, dict]:
    stations = {}
    for number, station in enumerate(place_stations(found, previous, STATION_COUNT), start=1):
        if station is not None:
            stations[f"{prefix}{number}"] = {
                "kind": station.kind,
                "key": station.key,
                "name": station.name,
                "trackhashes": station.tracks,
            }
    return stations


class RadioStations(HomepageRoutine):
    """
    The genre and decade stations of the radio. Every 6 hours; the tracks of
    each station are re-drawn once a day.
    """

    hours = 6

    @property
    def is_valid(self):
        return True

    def run(self):
        now = pendulum.now()
        day = now.date().toordinal()
        pools = station_pools(_library_facts(), skip=_skip)
        names = _genre_names()

        for userid in all_userids():
            if _stopping():
                return

            plays = list(ScrobbleTable.get_all(0, None, userid=userid))
            genres, decades = build_stations(pools, plays, track_facts, now.timestamp(), day, names, skip=_skip)

            if not genres and not decades:
                log.info("radio-stations: no genre or decade of user %s has enough plays and tracks", userid)

            # A station keeps the slot its key had last run ("genre2" stays rock),
            # as "Your mixes" does: the card and the dial name it by slot.
            stations = {
                **_slots("genre", genres, StationStore.keys_of(userid, "genre", STATION_COUNT)),
                **_slots("decade", decades, StationStore.keys_of(userid, "decade", STATION_COUNT)),
            }
            StationStore.replace(userid, stations)
