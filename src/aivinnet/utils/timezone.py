"""
The host's timezone, made safe to ask for.

pendulum works the local timezone out once, from TZ, /etc/timezone or
/etc/localtime, and RAISES when what it finds is not a valid name. Installing
tzdata into an Ubuntu 24.04 container that had no timezone yet writes "/UTC"
into /etc/timezone (seen 2026-10-07): every page that dates something relative
to now — the album and artist lists among them — answered 500, and the
Rediscover and On this day crons failed. A server must not break on its host's
clock configuration, so the check runs once at start, and a timezone that
cannot be read falls back to UTC with a warning saying how to set one.
"""

import logging

import pendulum

log = logging.getLogger(__name__)


def ensure_local_timezone() -> None:
    try:
        pendulum.local_timezone()
    except Exception as exc:
        log.warning(
            "The system timezone could not be read (%s); using UTC. Set TZ (e.g. TZ=Europe/Berlin) to use another.",
            exc,
        )
        pendulum.set_local_timezone(pendulum.UTC)
