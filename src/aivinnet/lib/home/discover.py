"""
Pure rules behind the homepage rows "Because you listened to …", "On repeat",
"Never played", "Your <weekday> <evenings>", "Artists you might like" and
"Forgotten favorites" (#138).

Like `homerows.py`, deliberately free of database and store imports: the
routines in `lib/recipes/homerows.py` read the scrobbles and resolve each
trackhash to its `TrackFacts`, and hand both to these functions. That keeps
the rules testable in the fast lane (see `.claude/rules/tests.md`).

Everything here is local: the user's own scrobbles and library, no service.
The one signal of "similar" is the user's own listening — what they play in
the same session — which is why it cannot die with a server the way the
mixes did.
"""

import math
import random
from collections import Counter
from datetime import datetime, timedelta
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import pendulum
from pendulum.tz import local_timezone

DAY = 86400

# A pause longer than this between two plays starts a new listening session.
# Measured from play START to play start, so it also covers a long track.
SESSION_GAP = 30 * 60

# "Because you listened to": the seed is the artist played most in the first
# window that has any plays at all.
SEED_WINDOWS_DAYS = (7, 30)
# An album must share at least this many sessions with the seed. One shared
# session is chance (one shuffle of a big playlist), two is a habit.
BECAUSE_MIN_SESSIONS = 2
# Albums played within this many days are left out: they are in "Recently
# played" already, and this row is for what goes WITH the seed.
BECAUSE_RECENT_DAYS = 7

# "On repeat": this week against the weeks before it.
REPEAT_DAYS = 7
REPEAT_BASELINE_WEEKS = 8
REPEAT_MIN_PLAYS = 3
REPEAT_MIN_FACTOR = 2.0
# Without a cap, one album played through three times fills the whole row.
REPEAT_MAX_PER_ALBUM = 2

# "Never played": below this many plays nearly the whole library is unplayed,
# and the row would only be the library in another order.
NEVER_MIN_HISTORY = 50
NEVER_MAX_PER_ARTIST = 2
# The row draws its items from the best `limit * NEVER_POOL_FACTOR`
# candidates, re-drawn each day — else it would show the same albums until the
# user plays them.
NEVER_POOL_FACTOR = 3

# "Your weekday evenings": the user's habits at this time of the week. Days
# are split into weekday/weekend and these bands (start hour, name); the
# hours before the first band belong to the last one ("nights").
TIME_BANDS = ((5, "mornings"), (11, "afternoons"), (17, "evenings"), (22, "nights"))
SLOT_DAYS = 180
SLOT_MIN_PLAYS = 3
# How much more an album is played in this slot than overall. Below that it is
# a favourite at every hour, and "Recently played" or Stats show it already.
SLOT_MIN_LIFT = 1.5
SLOT_RECENT_HOURS = 24
SLOT_MAX_PER_ARTIST = 2

# "Artists you might like": artists in the user's playlists next to their most
# played ones, which they hardly play themselves.
LIKE_TOP_ARTISTS = 10
LIKE_TOP_DAYS = 90
# Played this often or more, an artist is known, not a discovery.
LIKE_MAX_PLAYS = 5

# "Forgotten favorites": favourite tracks not played for this long.
FAVORITE_QUIET_DAYS = 60
FAVORITE_MAX_PER_ALBUM = 2

ROW_LIMIT = 15


class Play(Protocol):
    """The fields of `models.logger.TrackLog` these rules read."""

    trackhash: str
    timestamp: int


@dataclass(frozen=True)
class TrackFacts:
    """What the rules need to know about a scrobbled track."""

    albumhash: str
    # Album artists: the album is what the rows show, so its artist is the one
    # that counts — a featured guest on one track does not make an album "theirs".
    artists: tuple[str, ...]
    genres: tuple[str, ...] = ()
    # Other albums with a track of the same hash (two editions with the same
    # title, album name and artists). A play counts as played for all of them:
    # which edition it came from is not recorded.
    other_albums: tuple[str, ...] = ()
    # The track's own artists. Used where the album artist says nothing: a
    # "Various Artists" compilation is not an artist to recommend, its tracks are.
    track_artists: tuple[str, ...] = ()


@dataclass(frozen=True)
class AlbumFacts:
    albumhash: str
    artists: tuple[str, ...]
    genres: tuple[str, ...] = ()
    created: int = 0


@dataclass
class _Resolved:
    play: Play
    facts: TrackFacts


@dataclass
class BecauseResult:
    seed: str
    # (albumhash, shared sessions, last played)
    albums: list[tuple[str, int, int]] = field(default_factory=list)


def _resolve(plays: Iterable[Play], facts_of: Callable[[str], TrackFacts | None]) -> list[_Resolved]:
    """The plays whose track is still in the library, oldest first."""
    cache: dict[str, TrackFacts | None] = {}
    resolved = []

    for play in plays:
        if play.trackhash not in cache:
            cache[play.trackhash] = facts_of(play.trackhash)

        facts = cache[play.trackhash]
        if facts is not None:
            resolved.append(_Resolved(play, facts))

    resolved.sort(key=lambda r: r.play.timestamp)
    return resolved


def _sessions(resolved: Sequence[_Resolved], gap: int = SESSION_GAP) -> list[list[_Resolved]]:
    """
    Cut plays, oldest first, into listening sessions: a new session starts
    wherever two plays are more than `gap` seconds apart.
    """
    sessions: list[list[_Resolved]] = []
    last: int | None = None

    for r in resolved:
        if last is None or r.play.timestamp - last > gap:
            sessions.append([])
        sessions[-1].append(r)
        last = r.play.timestamp

    return sessions


def pick_seed_artist(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    now: float,
    skip: Callable[[str], bool] = lambda artisthash: False,
    windows: Sequence[int] = SEED_WINDOWS_DAYS,
) -> str | None:
    """
    The album artist the user played most in the first of `windows` (days
    back from `now`) that has any plays. Ties go to the artist played last.
    `skip(artisthash)` leaves out placeholders like "Various Artists".
    """
    resolved = _resolve(plays, facts_of)

    for days in windows:
        start = now - days * DAY
        counts: Counter[str] = Counter()
        last: dict[str, int] = {}

        for r in resolved:
            if not start <= r.play.timestamp <= now:
                continue
            for artist in r.facts.artists:
                if skip(artist):
                    continue
                counts[artist] += 1
                last[artist] = r.play.timestamp

        if counts:
            return max(counts, key=lambda a: (counts[a], last[a]))

    return None


def rank_because(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    seed: str,
    now: float,
    exclude: Callable[[str], bool] = lambda artisthash: False,
    min_sessions: int = BECAUSE_MIN_SESSIONS,
    recent_days: int = BECAUSE_RECENT_DAYS,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, int, int]]:
    """
    Albums by OTHER artists that the user plays in the same sessions as `seed`.

    Each session with the seed in it scores every other album in it with
    1/sqrt(number of other albums in the session): three albums around the
    seed in an evening say more about each other than eighty in a day-long
    shuffle of a big playlist. At least `min_sessions` shared sessions,
    none played in the last `recent_days`, one album per artist, and none
    whose album artists are all `exclude`d (untagged files).

    Returns `(albumhash, shared_sessions, last_played)`, best first.
    """
    resolved = _resolve(plays, facts_of)
    score: dict[str, float] = {}
    sessions_with: Counter[str] = Counter()
    artists_of: dict[str, tuple[str, ...]] = {}
    last: dict[str, int] = {}

    for r in resolved:
        last[r.facts.albumhash] = r.play.timestamp
        artists_of[r.facts.albumhash] = r.facts.artists

    for session in _sessions(resolved):
        if not any(seed in r.facts.artists for r in session):
            continue

        others = {r.facts.albumhash for r in session if seed not in r.facts.artists}
        if not others:
            continue

        weight = 1 / math.sqrt(len(others))
        for albumhash in others:
            score[albumhash] = score.get(albumhash, 0) + weight
            sessions_with[albumhash] += 1

    cutoff = now - recent_days * DAY
    ranked = sorted(
        (
            a
            for a in score
            if sessions_with[a] >= min_sessions
            and last[a] < cutoff
            and not all(exclude(artist) for artist in artists_of[a])
        ),
        key=lambda a: (score[a], sessions_with[a], last[a]),
        reverse=True,
    )

    result: list[tuple[str, int, int]] = []
    used_artists: set[str] = set()

    for albumhash in ranked:
        artists = set(artists_of[albumhash])
        if artists & used_artists:
            continue

        used_artists |= artists
        result.append((albumhash, sessions_with[albumhash], last[albumhash]))
        if len(result) >= limit:
            break

    return result


def because_item(albumhash: str, sessions: int, last_played: int) -> dict[str, Any]:
    return {
        "type": "album",
        "hash": albumhash,
        "help_text": f"{sessions} sessions together",
        "secondary_text": f"last {_month(last_played)}",
    }


def rank_on_repeat(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    now: float,
    days: int = REPEAT_DAYS,
    baseline_weeks: int = REPEAT_BASELINE_WEEKS,
    min_plays: int = REPEAT_MIN_PLAYS,
    min_factor: float = REPEAT_MIN_FACTOR,
    max_per_album: int = REPEAT_MAX_PER_ALBUM,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, int, float]]:
    """
    Tracks played much more in the last `days` than the user's weekly average
    over the `baseline_weeks` before: at least `min_plays` this week and at
    least `min_factor` times the average. A track new to the user (no plays
    before) qualifies on `min_plays` alone.

    Ranked by the plays above the average — the trend, not the total, which is
    what sets this row apart from the charts on the Stats page.

    Returns `(trackhash, plays_this_week, weekly_average_before)`.
    """
    week_start = now - days * DAY
    base_start = week_start - baseline_weeks * 7 * DAY
    week: Counter[str] = Counter()
    before: Counter[str] = Counter()
    last: dict[str, int] = {}
    album_of: dict[str, str] = {}

    for r in _resolve(plays, facts_of):
        ts = r.play.timestamp
        if week_start <= ts <= now:
            week[r.play.trackhash] += 1
            last[r.play.trackhash] = ts
            album_of[r.play.trackhash] = r.facts.albumhash
        elif base_start <= ts < week_start:
            before[r.play.trackhash] += 1

    candidates = []
    for trackhash, count in week.items():
        average = before[trackhash] / baseline_weeks
        if count >= min_plays and count >= min_factor * average:
            candidates.append((trackhash, count, average))

    candidates.sort(key=lambda c: (c[1] - c[2], c[1], last[c[0]]), reverse=True)

    result = []
    per_album: Counter[str] = Counter()
    for trackhash, count, average in candidates:
        albumhash = album_of[trackhash]
        if per_album[albumhash] >= max_per_album:
            continue

        per_album[albumhash] += 1
        result.append((trackhash, count, average))
        if len(result) >= limit:
            break

    return result


def on_repeat_item(trackhash: str, plays: int, average: float) -> dict[str, Any]:
    if average == 0:
        # Only the baseline weeks are read: a track loved last year and
        # back now is not "new", so this says no more than it knows.
        usual = "not in the 8 weeks before"
    elif average < 1:
        usual = "rarely before"
    else:
        usual = f"usually {round(average)} a week"

    return {
        "type": "track",
        "hash": trackhash,
        "help_text": f"{plays} plays this week",
        "secondary_text": usual,
    }


def rank_never_played(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    albums: Iterable[AlbumFacts],
    day: int,
    min_history: int = NEVER_MIN_HISTORY,
    max_per_artist: int = NEVER_MAX_PER_ARTIST,
    pool_factor: int = NEVER_POOL_FACTOR,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, str | None, str | None]] | None:
    """
    Albums of the library the user has never played a track of, nearest to
    their taste first: an album by an artist they play scores by that
    artist's share of their plays (doubled — the artist is the stronger
    hint), plus the share of its best-played genre.

    The row is drawn from the best `limit * pool_factor` candidates (at most
    `max_per_artist` per artist), re-drawn per `day` (any int that changes
    daily), then shown best first.

    Returns `(albumhash, artisthash, genrehash)` — the artist or genre that put
    the album here, None where nothing did — or None (not []) when the
    history is shorter than `min_history`, so the caller can say why.
    """
    resolved = _resolve(plays, facts_of)
    if len(resolved) < min_history:
        return None

    played = {r.facts.albumhash for r in resolved} | {a for r in resolved for a in r.facts.other_albums}
    artist_plays: Counter[str] = Counter()
    genre_plays: Counter[str] = Counter()
    for r in resolved:
        artist_plays.update(set(r.facts.artists))
        genre_plays.update(set(r.facts.genres))

    total = len(resolved)
    scored = []

    for album in albums:
        if album.albumhash in played:
            continue

        artist = max(album.artists, key=lambda a: artist_plays[a], default=None)
        genre = max(album.genres, key=lambda g: genre_plays[g], default=None)
        a_share = artist_plays[artist] / total if artist else 0
        g_share = genre_plays[genre] / total if genre else 0

        reason_artist = artist if a_share > 0 else None
        reason_genre = genre if g_share > 0 else None
        scored.append((2 * a_share + g_share, album.created, album, reason_artist, reason_genre))

    scored.sort(key=lambda s: (s[0], s[1], s[2].albumhash), reverse=True)

    pool = []
    per_artist: Counter[str] = Counter()
    for entry in scored:
        artists = entry[2].artists
        if any(per_artist[a] >= max_per_artist for a in artists):
            continue

        per_artist.update(artists)
        pool.append(entry)
        if len(pool) >= limit * pool_factor:
            break

    picked = random.Random(day).sample(pool, min(limit, len(pool)))
    picked.sort(key=lambda s: (s[0], s[1], s[2].albumhash), reverse=True)

    return [(s[2].albumhash, s[3], s[4]) for s in picked]


def never_played_item(albumhash: str, reason: str | None) -> dict[str, Any]:
    """`reason` is the text shown on the card: "you play Primus", "Funk Rock"."""
    if reason is None:
        return {"type": "album", "hash": albumhash, "help_text": "never played"}

    return {"type": "album", "hash": albumhash, "help_text": reason, "secondary_text": "never played"}


def _plays(n: int) -> str:
    return f"{n} {'play' if n == 1 else 'plays'}"


def _month(timestamp: int) -> str:
    return pendulum.from_timestamp(timestamp).in_timezone(local_timezone()).format("MMMM YYYY")


def time_slot(dt: datetime) -> tuple[bool, str]:
    """
    `(weekend, band)` of a local time: Saturday 20:00 is `(True, "evenings")`.

    The hours after midnight belong to the night they continue: Saturday
    01:00 is still Friday night (a weekday), Monday 01:00 still Sunday night.
    Otherwise one late session would fall into two slots.
    """
    band = TIME_BANDS[-1][1]
    for start, name in TIME_BANDS:
        if dt.hour >= start:
            band = name

    day = dt - timedelta(days=1) if dt.hour < TIME_BANDS[0][0] else dt
    return day.weekday() >= 5, band


def slot_title(slot: tuple[bool, str]) -> str:
    weekend, band = slot
    return f"Your {'weekend' if weekend else 'weekday'} {band}"


def rank_for_this_time(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    now: pendulum.DateTime,
    exclude: Callable[[str], bool] = lambda artisthash: False,
    uncapped: Callable[[str], bool] = lambda artisthash: False,
    days: int = SLOT_DAYS,
    min_plays: int = SLOT_MIN_PLAYS,
    min_lift: float = SLOT_MIN_LIFT,
    recent_hours: int = SLOT_RECENT_HOURS,
    max_per_artist: int = SLOT_MAX_PER_ARTIST,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, int]]:
    """
    Albums the user plays in the current time slot (`time_slot` of `now`, in
    `now`'s timezone) noticeably more than at other times: at least
    `min_plays` there over the last `days`, and a share of the slot's plays
    at least `min_lift` times their share of all plays. Nothing played in the
    last `recent_hours`, nothing whose album artists are all `exclude`d
    (untagged files), at most `max_per_artist` albums per artist —
    `uncapped` artists ("Various Artists") count for none.

    Ranked by plays in the slot times that lift. Returns
    `(albumhash, plays_in_slot)`.
    """
    # The stdlib conversion: this runs for every play of half a year, hourly,
    # and pendulum's is many times slower. A pendulum timezone is a tzinfo.
    tz = now.tzinfo
    current = time_slot(now)
    start = now.timestamp() - days * DAY
    recent = now.timestamp() - recent_hours * 3600

    in_slot: Counter[str] = Counter()
    overall: Counter[str] = Counter()
    artists_of: dict[str, tuple[str, ...]] = {}
    last: dict[str, int] = {}
    slot_total = 0
    total = 0

    for r in _resolve(plays, facts_of):
        ts = r.play.timestamp
        if not start <= ts <= now.timestamp():
            continue

        album = r.facts.albumhash
        total += 1
        overall[album] += 1
        artists_of[album] = r.facts.artists
        last[album] = ts

        if time_slot(datetime.fromtimestamp(ts, tz)) == current:
            slot_total += 1
            in_slot[album] += 1

    scored = []
    for album, count in in_slot.items():
        lift = (count / slot_total) / (overall[album] / total)
        if all(exclude(a) for a in artists_of[album]):
            continue
        if count >= min_plays and lift >= min_lift and last[album] < recent:
            scored.append((count * lift, count, album))

    scored.sort(reverse=True)

    result = []
    per_artist: Counter[str] = Counter()
    for _, count, album in scored:
        artists = [a for a in artists_of[album] if not uncapped(a)]
        if any(per_artist[a] >= max_per_artist for a in artists):
            continue

        per_artist.update(artists)
        result.append((album, count))
        if len(result) >= limit:
            break

    return result


def for_this_time_item(albumhash: str, plays: int) -> dict[str, Any]:
    return {"type": "album", "hash": albumhash, "help_text": f"{_plays(plays)} at this time"}


def _artists(facts: TrackFacts, skip: Callable[[str], bool]) -> set[str]:
    """The album artists, or the track's own artists for a compilation."""
    artists = {a for a in facts.artists if not skip(a)}
    return artists or {a for a in facts.track_artists if not skip(a)}


def rank_playlist_neighbours(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    playlists: Iterable[Sequence[str]],
    now: float,
    skip: Callable[[str], bool] = lambda artisthash: False,
    top: int = LIKE_TOP_ARTISTS,
    top_days: int = LIKE_TOP_DAYS,
    max_plays: int = LIKE_MAX_PLAYS,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, int, int]]:
    """
    Artists that share the user's own playlists (each a list of trackhashes)
    with their `top` most played artists of the last `top_days`, but that the
    user has played fewer than `max_plays` times in all.

    A playlist scores each such artist with 1/sqrt(number of other artists in
    it): a hand-made playlist of eight artists is a stronger hint than an
    "everything" list of three hundred.

    Returns `(artisthash, playlists_shared, plays)`, best first.
    """
    resolved = _resolve(plays, facts_of)
    played: Counter[str] = Counter()
    recent: Counter[str] = Counter()

    for r in resolved:
        names = _artists(r.facts, skip)
        played.update(names)
        if r.play.timestamp >= now - top_days * DAY:
            recent.update(names)

    favourites = {a for a, _ in recent.most_common(top)}
    if not favourites:
        return []

    score: dict[str, float] = {}
    shared: Counter[str] = Counter()
    # Playlists overlap ("everything" plus its subsets): resolve each track once.
    artists_of: dict[str, set[str]] = {}

    for playlist in playlists:
        artists: set[str] = set()
        for trackhash in playlist:
            if trackhash not in artists_of:
                facts = facts_of(trackhash)
                artists_of[trackhash] = _artists(facts, skip) if facts else set()
            artists |= artists_of[trackhash]

        others = artists - favourites
        if not others or not artists & favourites:
            continue

        weight = 1 / math.sqrt(len(others))
        for artist in others:
            if played[artist] < max_plays:
                score[artist] = score.get(artist, 0) + weight
                shared[artist] += 1

    ranked = sorted(score, key=lambda a: (score[a], shared[a], -played[a], a), reverse=True)
    return [(a, shared[a], played[a]) for a in ranked[:limit]]


def playlist_neighbour_item(artisthash: str, playlists: int, plays: int) -> dict[str, Any]:
    where = "in one of your playlists" if playlists == 1 else f"in {playlists} of your playlists"
    item = {"type": "artist", "hash": artisthash, "help_text": where}
    item["secondary_text"] = "never played" if plays == 0 else _plays(plays)
    return item


def rank_forgotten_favorites(
    favorites: Iterable[str],
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    now: float,
    quiet_days: int = FAVORITE_QUIET_DAYS,
    max_per_album: int = FAVORITE_MAX_PER_ALBUM,
    limit: int = ROW_LIMIT,
) -> list[tuple[str, int, int | None]]:
    """
    Favourite tracks (trackhashes) not played in the last `quiet_days`, or
    never. The ones played most before go first — a favourite that was on
    heavy rotation and then dropped out is the one most worth a reminder —
    then the one silent longest. At most `max_per_album` per album.

    Returns `(trackhash, plays, last_played or None)`.
    """
    count: Counter[str] = Counter()
    last: dict[str, int] = {}
    for play in plays:
        count[play.trackhash] += 1
        last[play.trackhash] = max(last.get(play.trackhash, play.timestamp), play.timestamp)

    cutoff = now - quiet_days * DAY
    candidates = []
    for trackhash in set(favorites):
        facts = facts_of(trackhash)
        if facts is None:
            continue
        if trackhash in last and last[trackhash] >= cutoff:
            continue
        candidates.append((trackhash, facts.albumhash))

    candidates.sort(key=lambda c: (-count[c[0]], last.get(c[0], 0), c[0]))

    result: list[tuple[str, int, int | None]] = []
    per_album: Counter[str] = Counter()
    for trackhash, album in candidates:
        if per_album[album] >= max_per_album:
            continue

        per_album[album] += 1
        result.append((trackhash, count[trackhash], last.get(trackhash)))
        if len(result) >= limit:
            break

    return result


def forgotten_favorite_item(trackhash: str, plays: int, last_played: int | None) -> dict[str, Any]:
    if last_played is None:
        return {"type": "track", "hash": trackhash, "help_text": "not played yet"}

    return {
        "type": "track",
        "hash": trackhash,
        "help_text": f"last {_month(last_played)}",
        "secondary_text": _plays(plays),
    }
