"""
"Continue listening": the newest albums/playlists the user has not finished.
The rule lives in `lib/home/homerows.py::find_continue_listening`.
"""

import logging

from aivinnet.db.userdata import PlaylistTable, ScrobbleTable, UserTable
from aivinnet.lib.albumslib import sort_by_track_no
from aivinnet.lib.home.homerows import CONTINUE_SEARCH_LIMIT, find_continue_listening
from aivinnet.lib.recipes import HomepageRoutine
from aivinnet.store.albums import AlbumStore
from aivinnet.store.homepage import HomepageStore

log = logging.getLogger(__name__)


def all_userids(userid: int | None = None) -> list[int]:
    return [userid] if userid else [user.id for user in UserTable.get_all()]


def _resolve_tracklist(userid: int):
    def resolve(srctype: str, src: str) -> list[str] | None:
        if srctype == "album":
            tracks = AlbumStore.get_album_tracks(src)
            return [t.trackhash for t in sort_by_track_no(tracks)]

        try:
            playlistid = int(src)
        except ValueError:
            return None

        return PlaylistTable.get_trackhashes_of_user(playlistid, userid)

    return resolve


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
                items = find_continue_listening(scrobbles, _resolve_tracklist(userid))
            except Exception:
                log.error("continue-listening refresh failed for user %s", userid, exc_info=True)
                continue

            HomepageStore.entries[self.store_key].items[userid] = items
