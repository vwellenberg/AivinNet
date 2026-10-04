"""
Routines for the personal homepage rows "Rediscover" and "On this day". The
rules themselves live in `lib/home/homerows.py`.

Scheduled by `crons/__init__.py` (`schedule.every(cls.hours)`), deliberately
NOT as `CronJob` subclasses: importing `crons.cron` runs `crons/__init__`,
which imports this module — any import of this module that does not come from
the cron package would then hit a half-initialized module (circular import).

Both are per user and purely local (scrobbles + own library).
"""

import logging

import pendulum

from aivinnet.db.userdata import ScrobbleTable
from aivinnet.lib.home.create_items import create_items
from aivinnet.lib.home.homerows import (
    ROW_LIMIT,
    on_this_day_window,
    rank_rediscover,
    rediscover_item,
)
from aivinnet.lib.recipes import HomepageRoutine
from aivinnet.lib.recipes.continuelistening import all_userids
from aivinnet.store.albums import AlbumStore
from aivinnet.store.homepage import HomepageStore
from aivinnet.store.tracks import TrackStore

log = logging.getLogger(__name__)


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
            entry = TrackStore.trackhashmap.get(trackhash)
            if entry is None:
                return None

            albumhash = entry.tracks[0].albumhash
            return albumhash if albumhash in AlbumStore.albummap else None

        for userid in all_userids():
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
