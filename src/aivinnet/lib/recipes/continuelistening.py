"""
"Continue listening": the newest albums/playlists the user has not finished.
The rule lives in `lib/home/homerows.py::find_continue_listening`.
"""

import logging
from collections import Counter

from aivinnet.db.userdata import PlaylistTable, ScrobbleTable, UserTable
from aivinnet.lib.albumslib import sort_by_track_no
from aivinnet.lib.home.homerows import (
    CONTINUE_MAX_ITEMS,
    CONTINUE_SEARCH_LIMIT,
    CONTINUE_SPARE_ITEMS,
    find_continue_listening,
    parse_playlist_id,
)
from aivinnet.lib.recipes import HomepageRoutine
from aivinnet.store.albums import AlbumStore
from aivinnet.store.homepage import HomepageStore
from aivinnet.store.tracks import TrackStore

log = logging.getLogger(__name__)


def all_userids(userid: int | None = None) -> list[int]:
    return [userid] if userid else [user.id for user in UserTable.get_all()]


def _resolve_tracklist(userid: int):
    def resolve(srctype: str, src: str) -> list[str] | None:
        if srctype == "album":
            tracks = AlbumStore.get_album_tracks(src)
            return [t.trackhash for t in sort_by_track_no(tracks)]

        playlistid = parse_playlist_id(src)
        if playlistid is None:
            return None

        hashes = PlaylistTable.get_trackhashes_of_user(playlistid, userid)
        if hashes is None:
            return None

        # What the client plays: without the orphans (hashes no longer in the
        # library), the last playable track finishes the playlist (#391).
        return [h for h in hashes if h in TrackStore.trackhashmap]

    return resolve


def _duration_of(trackhash: str) -> float:
    group = TrackStore.trackhashmap.get(trackhash)
    return group.get_best().duration if group else 0


def album_year(albumhash: str) -> int | None:
    """
    The album's release year for its card: the year most of its tracks are
    tagged with, or None when none carries one. Read per track through
    `Track.release_year()`, which knows that an untagged file's `date` is its
    mtime — `Album.date` would show the year a folder was copied.
    """
    years = [y for t in AlbumStore.get_album_tracks(albumhash) if (y := t.release_year())]
    return Counter(years).most_common(1)[0][0] if years else None


class ContinueListening(HomepageRoutine):
    """
    "Continue listening": the newest unfinished album or playlist.

    Runs at startup for every user and, with a `userid`, after each scrobble
    (`api/scrobble`). That second path is inside a request, so it reads only
    the newest `CONTINUE_SEARCH_LIMIT` scrobbles and resolves albums from RAM;
    a playlist costs one small column read.
    """

    store_key = "continue_listening"

    def __init__(self, userid: int | None = None) -> None:
        self.userids = all_userids(userid)
        super().__init__()

    @property
    def is_valid(self):
        return True

    def run(self):
        for userid in self.userids:
            # Best effort: a homepage row must never fail the scrobble that
            # triggered it — that one is already written.
            try:
                scrobbles = ScrobbleTable.get_all(0, CONTINUE_SEARCH_LIMIT, userid=userid)
                items = find_continue_listening(
                    scrobbles,
                    _resolve_tracklist(userid),
                    limit=CONTINUE_MAX_ITEMS + CONTINUE_SPARE_ITEMS,
                    duration_of=_duration_of,
                )
                # The year for the card's subtitle ("Artist · 2019 · 38 min
                # left"): only this row asks for it, so it is added here and
                # not to every Home album card.
                for item in items:
                    if item["type"] == "album":
                        item["year"] = album_year(item["hash"])
            except Exception:
                log.error("continue-listening refresh failed for user %s", userid, exc_info=True)
                continue

            HomepageStore.entries[self.store_key].items[userid] = items
