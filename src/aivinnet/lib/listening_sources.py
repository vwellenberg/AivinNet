"""
How the user listens (#538): what their plays were started from — albums,
playlists, Home, artists, folders, search, favorites. One rule for the stats
tile ("84% albums · 8% playlists") and the listener type in Rewind (#527).

Pure like `lib/rewind.py`, strict under mypy.
"""

from collections import Counter
from collections.abc import Container, Iterable

# Where a play was started from (the client's `getSource`, `stores/tracker.ts`),
# by prefix. A generated playlist (`homerows.CUSTOM_PLAYLISTS`) counts as Home.
SOURCES = (("al:", "album"), ("pl:", "playlist"), ("ar:", "artist"), ("fo:", "folder"), ("pf:", "playlist"))
SOURCE_SEARCH = "q:"
SOURCE_FAVORITE = "favorite"
# Plays that name no kind of listener: a single track, the queue, an old client.
OTHER = "other"

# What the stats tile calls each kind.
KIND_WORDS = {
    "album": "albums",
    "playlist": "playlists",
    "home": "Home",
    "artist": "artists",
    "folder": "folders",
    "search": "search",
    "favorites": "favorites",
}


def source_kind(source: str, generated: Container[str] = frozenset()) -> str:
    """
    What a play was started from: album, playlist, artist, folder, search,
    favorites, home (a playlist the server generates — the mixes, On repeat …)
    or other (a single track, the queue, an old client).
    """
    if source.startswith("pl:") and source[3:] in generated:
        return "home"
    for prefix, kind in SOURCES:
        if source.startswith(prefix):
            return kind
    if source.startswith(SOURCE_SEARCH):
        return "search"
    if source == SOURCE_FAVORITE:
        return "favorites"
    return OTHER


def count_kinds(plays_by_source: Iterable[tuple[str, int]], generated: Container[str] = frozenset()) -> Counter[str]:
    """Plays per kind, from plays per stored source (`al:<hash>`, `pl:7` …)."""
    kinds: Counter[str] = Counter()
    for source, plays in plays_by_source:
        kinds[source_kind(source, generated)] += plays
    return kinds


def source_shares(kinds: Counter[str]) -> list[tuple[str, float]]:
    """
    Each named kind's share of ALL plays, largest first, rounded to hundredths.
    "Other" is never named, but its plays are still plays: the shares are of
    all of them, so they add up to less than one when some came from nowhere.
    Ties go by name, as Rewind's top lists do (`rewind._top`), so the answer
    does not depend on the order the plays came in.
    """
    total = sum(kinds.values())
    if not total:
        return []
    named = sorted(((kind, n) for kind, n in kinds.items() if kind != OTHER and n > 0), key=lambda kn: (-kn[1], kn[0]))
    return [(kind, round(n / total, 2)) for kind, n in named]


def shares_text(shares: list[tuple[str, float]], named: int = 2) -> str:
    """
    "62% albums · 25% playlists": the largest kinds, as the tile says it. A
    kind after the first that rounds to 0% is left out: "100% albums · 0%
    search" says nothing the first half did not.
    """
    if not shares:
        return "—"
    shown = shares[:1] + [(kind, share) for kind, share in shares[1:named] if round(share * 100) > 0]
    return " · ".join(f"{round(share * 100)}% {KIND_WORDS.get(kind, kind)}" for kind, share in shown)
