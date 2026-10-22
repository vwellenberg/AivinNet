"""
"Your mixes" (#526): two to four playlists cut from the user's own listening
sessions, the local successor of the cloud mixes that died with
`smcloud.mungaist.com` (#76/#77).

The signal is the one "Because you listened to …" uses: artists played in the
same session belong together. Here it is not one seed against the rest but the
whole picture — the most played artists that do NOT go together become the
cores, every other artist joins the core it is played with most, and each
group is a mix: tracks the user knows, alternating with ones they have never
played, artist by artist.

Pure rules like `discover.py` (no database, no stores): the routine in
`lib/recipes/homerows.py` hands in the plays, the facts of a track and the
library tracks of an artist. Testable in the fast lane, strict under mypy.
"""

import math
import random
from collections import Counter, defaultdict, deque
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from aivinnet.lib.home.discover import DAY, Play, TrackFacts, _artists, _resolve, _Resolved, _sessions

# The taste of the last half year: older sessions say who the user was.
MIX_DAYS = 180
# Below this many plays in that time there are no sessions to read groups from.
MIX_MIN_HISTORY = 50
MIX_COUNT = 4
# Played this often in the window, an artist takes part at all.
MIX_MIN_ARTIST_PLAYS = 3
# A mix of one or two artists is an artist page, not a mix.
MIX_MIN_ARTISTS = 3
# Two cores closer than this would make two mixes of the same music. The
# affinity is co-occurrence normalised by how often each was played (0..1).
MIX_CORE_MAX_AFFINITY = 0.25
# Closer than this to its core, an artist joins the mix. One shared day-long
# shuffle of eighty artists is no tie (its affinity is around 0.01).
MIX_MIN_MEMBER_AFFINITY = 0.1
MIX_LENGTH = 30
MIX_MIN_TRACKS = 8
MIX_MAX_PER_ALBUM = 3
# The artists that name a mix on its card.
MIX_NAMED_ARTISTS = 3

# The generated playlists the mixes are served as (`generated_playlists`).
MIX_PLAYLIST_IDS = tuple(f"mix{n}" for n in range(1, MIX_COUNT + 1))


@dataclass
class Mix:
    # Core first, then the members by how close they are to it.
    artists: list[str]
    tracks: list[str] = field(default_factory=list)


def _affinities(
    sessions: Iterable[set[str]],
) -> tuple[Counter[str], defaultdict[str, defaultdict[str, float]]]:
    """Sessions per artist, and the weighted co-occurrence of every pair."""
    seen: Counter[str] = Counter()
    together: defaultdict[str, defaultdict[str, float]] = defaultdict(lambda: defaultdict(float))

    for artists in sessions:
        seen.update(artists)
        if len(artists) < 2:
            continue
        # Like "Because you listened": a session of three artists says more
        # about each pair in it than a day-long shuffle of eighty.
        weight = 1 / math.sqrt(len(artists) - 1)
        for a in artists:
            for b in artists:
                if a != b:
                    together[a][b] += weight

    return seen, together


def group_artists(
    plays: Iterable[Play],
    facts_of: Callable[[str], TrackFacts | None],
    now: float,
    skip: Callable[[str], bool] = lambda artisthash: False,
    **limits: Any,
) -> list[list[str]] | None:
    """
    The artist groups the mixes are made of, strongest core first. None (not
    []) when the history of the last `MIX_DAYS` is shorter than
    `MIX_MIN_HISTORY`, so the caller can say why there are no mixes.

    `skip` leaves out placeholders; a compilation counts for its track artists
    (`discover._artists`). `limits` override the module's thresholds.
    """
    return _groups(_resolve(plays, facts_of), now, skip, **limits)


def _groups(
    resolved: Sequence[_Resolved],
    now: float,
    skip: Callable[[str], bool],
    days: int = MIX_DAYS,
    min_history: int = MIX_MIN_HISTORY,
    count: int = MIX_COUNT,
    min_artist_plays: int = MIX_MIN_ARTIST_PLAYS,
    min_artists: int = MIX_MIN_ARTISTS,
    max_core_affinity: float = MIX_CORE_MAX_AFFINITY,
    min_member_affinity: float = MIX_MIN_MEMBER_AFFINITY,
) -> list[list[str]] | None:
    start = now - days * DAY
    window = [r for r in resolved if start <= r.play.timestamp <= now]
    if len(window) < min_history:
        return None

    plays_of: Counter[str] = Counter()
    for r in window:
        plays_of.update(_artists(r.facts, skip))

    sessions = [{a for r in session for a in _artists(r.facts, skip)} for session in _sessions(window)]
    seen, together = _affinities(sessions)

    def affinity(a: str, b: str) -> float:
        if not seen[a] or not seen[b]:
            return 0.0
        pairs = together.get(a)
        return (pairs.get(b, 0.0) if pairs else 0.0) / math.sqrt(seen[a] * seen[b])

    # Most played first; ties by hash, so a run does not depend on dict order.
    candidates = sorted((a for a, n in plays_of.items() if n >= min_artist_plays), key=lambda a: (-plays_of[a], a))

    # A core whose group comes out too small gives its place up and becomes an
    # ordinary candidate, and the cores are picked again: otherwise it held one
    # of the `count` places, and a valid fourth group was never looked at.
    not_a_core: set[str] = set()
    while True:
        cores: list[str] = []
        for artist in candidates:
            if artist in not_a_core:
                continue
            if all(affinity(artist, core) < max_core_affinity for core in cores):
                cores.append(artist)
            if len(cores) >= count:
                break

        members: dict[str, list[tuple[float, str]]] = {core: [] for core in cores}
        for artist in candidates:
            if artist in members or not cores:
                continue
            best = max(cores, key=lambda core: affinity(artist, core))
            closeness = affinity(artist, best)
            if closeness >= min_member_affinity:
                members[best].append((closeness, artist))

        too_small = {core for core in cores if 1 + len(members[core]) < min_artists}
        if not too_small:
            break
        not_a_core |= too_small

    groups = []
    for core in cores:
        ranked = sorted(members[core], key=lambda m: (-m[0], -plays_of[m[1]], m[1]))
        groups.append([core, *(artist for _, artist in ranked)])

    return groups


def known_tracks(
    resolved: Iterable[_Resolved],
    skip: Callable[[str], bool] = lambda artisthash: False,
    since: float = 0,
) -> tuple[dict[str, Counter[str]], set[str]]:
    """
    Plays per track for every artist since `since`, and every track the user
    ever played. Two windows on purpose: a mix opens with this half year's
    favourites, not a track played 200 times in 2022 — but a track heard once,
    years ago, is no "never played" either.
    """
    known: dict[str, Counter[str]] = defaultdict(Counter)
    played: set[str] = set()

    for r in resolved:
        played.add(r.play.trackhash)
        if r.play.timestamp < since:
            continue
        for artist in _artists(r.facts, skip):
            known[artist][r.play.trackhash] += 1

    return known, played


def mix_tracks(
    artists: Sequence[str],
    known: dict[str, Counter[str]],
    played: set[str],
    facts_of: Callable[[str], TrackFacts | None],
    tracks_of: Callable[[str], Iterable[str]],
    seed: int,
    length: int = MIX_LENGTH,
    max_per_album: int = MIX_MAX_PER_ALBUM,
) -> list[str]:
    """
    The tracks of one mix: artist by artist in turn (the group's order), each
    giving a track the user knows — their most played of that artist first —
    then one they have never played, and so on. At most `max_per_album` per
    album, each track once.

    `known` and `played` come from `known_tracks`; `tracks_of(artisthash)` is
    the artist's trackhashes in the library. The album of every track comes
    from `facts_of`, known or not, so the cap counts one album one way. The
    never-played tracks are shuffled with `seed`, so the mix changes from day
    to day; the known ones stay in order.
    """
    rng = random.Random(seed)
    queues: list[deque[str]] = []

    for artist in artists:
        fresh = [trackhash for trackhash in sorted(set(tracks_of(artist))) if trackhash not in played]
        rng.shuffle(fresh)
        favourites = [t for t, _ in sorted(known[artist].items(), key=lambda kv: (-kv[1], kv[0]))]

        queue: deque[str] = deque()
        for i in range(max(len(favourites), len(fresh))):
            queue.extend(favourites[i : i + 1] + fresh[i : i + 1])
        queues.append(queue)

    album_of: dict[str, str] = {}

    def album(trackhash: str) -> str:
        if trackhash not in album_of:
            facts = facts_of(trackhash)
            album_of[trackhash] = facts.albumhash if facts else trackhash
        return album_of[trackhash]

    picked: list[str] = []
    taken: set[str] = set()
    per_album: Counter[str] = Counter()

    while len(picked) < length and any(queues):
        for queue in queues:
            while queue:
                trackhash = queue.popleft()
                if trackhash in taken or per_album[album(trackhash)] >= max_per_album:
                    continue
                taken.add(trackhash)
                per_album[album(trackhash)] += 1
                picked.append(trackhash)
                break
            if len(picked) >= length:
                break

    return picked


def build_mixes(
    plays: Sequence[Play],
    facts_of: Callable[[str], TrackFacts | None],
    tracks_of: Callable[[str], Iterable[str]],
    now: float,
    day: int,
    skip: Callable[[str], bool] = lambda artisthash: False,
    min_tracks: int = MIX_MIN_TRACKS,
) -> list[Mix] | None:
    """
    The user's mixes, or None below the history threshold (`group_artists`).
    `day` is any int that changes daily: it re-draws the never-played tracks.
    A group too small to fill `min_tracks` makes no mix.
    """
    # Resolved once: the routine reads the whole history for every user.
    resolved = _resolve(plays, facts_of)
    groups = _groups(resolved, now, skip)
    if groups is None:
        return None

    known, played = known_tracks(resolved, skip, since=now - MIX_DAYS * DAY)
    mixes = []
    for index, artists in enumerate(groups):
        tracks = mix_tracks(artists, known, played, facts_of, tracks_of, seed=day * 31 + index)
        if len(tracks) >= min_tracks:
            mixes.append(Mix(artists, tracks))

    return mixes


def place_mixes(mixes: Sequence[Mix], previous_cores: Sequence[str | None], slots: int = MIX_COUNT) -> list[Mix | None]:
    """
    Each mix in the slot its core had in the last run, the new ones in the free
    slots in order. A mix is served by its slot ("mix2"), so without this a
    group that dropped out shifted every mix after it: an open page or a card
    for "Mix 2" played the metal of yesterday's "Mix 3" under the old name.
    """
    placed: list[Mix | None] = [None] * slots
    rest: list[Mix] = []

    for mix in mixes[:slots]:
        core = mix.artists[0]
        slot = next((i for i, c in enumerate(previous_cores[:slots]) if c == core), None)
        if slot is not None and placed[slot] is None:
            placed[slot] = mix
        else:
            rest.append(mix)

    free = [i for i in range(slots) if placed[i] is None]
    for slot, mix in zip(free, rest, strict=False):
        placed[slot] = mix

    return placed
