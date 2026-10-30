"""
The genre and decade stations of the Subspace radio (#640), per user: the
generated playlists "genre1" … "genre4" and "decade1" … "decade4".

Filled by the routine in `lib/recipes/stations.py` every 6 hours and read by
`lib/home/onrepeat.get_station_playlist` (the playlist endpoint) and the
station list of `GET /nothome/stations`. RAM only, like the homepage rows; a
restart waits for the routine's first run.
"""

from typing import Any


class StationStore:
    # userid -> playlist id -> {"kind", "key", "name", "trackhashes"}. A slot
    # without a station is absent.
    stations: dict[int, dict[str, dict[str, Any]]] = {}

    @classmethod
    def of(cls, userid: int) -> dict[str, dict[str, Any]]:
        return cls.stations.get(userid, {})

    @classmethod
    def get(cls, userid: int, playlistid: str) -> dict[str, Any] | None:
        return cls.of(userid).get(playlistid)

    @classmethod
    def keys_of(cls, userid: int, prefix: str, slots: int) -> list[str | None]:
        """The key each slot of one kind held in the last run ("genre" → genre1 …)."""
        stored = cls.of(userid)
        keys: list[str | None] = []
        for number in range(1, slots + 1):
            station = stored.get(f"{prefix}{number}")
            keys.append(station["key"] if station else None)
        return keys

    @classmethod
    def replace(cls, userid: int, stations: dict[str, dict[str, Any]]) -> None:
        """Store a user's whole set of stations at once: readers see all or none of the old run."""
        cls.stations[userid] = stations

    @classmethod
    def forget_user(cls, userid: int) -> None:
        cls.stations.pop(userid, None)
