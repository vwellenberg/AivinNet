"""
Smart playlists: a playlist that is a set of rules, evaluated against the library.

Pure: no database, no stores, standard library only, so the fast test lane
runs it. The glue that reads the stores and the scrobbles is in
`lib/smart_playlist_tracks.py`. This module decides which tracks match, in
which order, and how many; a definition that cannot be evaluated is refused
here, with a message that names the rule, before anything is stored.

A definition is `match` ("all" or "any" of its rules), `rules`, `limit` and
`sort`:

- genre, artist, albumartist: names. `is` / `is_not` compare case-insensitively,
  `contains` is a case-insensitive substring. A track with several genres
  matches `is` when one of them is the value.
- year, playcount: `eq`, `lt`, `gt`, `between` ([low, high], both inclusive).
  A track without a year matches none of these.
- date_added, last_played: `in_last_days` / `not_in_last_days` (a count of
  days), and `never` for last_played. A track never played has no last_played:
  it is not "in the last N days", so `not_in_last_days` matches it.
- favorite: `is` true or false.

`sort` is `"random"` or `{"field": <field>, "order": "asc" | "desc"}`. Tracks
without a value for the field (a year, a last play) go last in either order.
Ties are broken by title. A random sort is reproducible for a given `seed`, so
a playlist shown page by page keeps one order across requests.
"""

import random
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

MATCH_MODES = ("all", "any")
DEFAULT_MATCH = "all"
DEFAULT_LIMIT = 100
MAX_LIMIT = 1000
RANDOM = "random"
DEFAULT_SORT_FIELD = "date_added"
SECONDS_PER_DAY = 86_400

STRING_FIELDS = ("genre", "artist", "albumartist")
NUMBER_FIELDS = ("year", "playcount")
DATE_FIELDS = ("date_added", "last_played")
FLAG_FIELDS = ("favorite",)
FIELDS = STRING_FIELDS + NUMBER_FIELDS + DATE_FIELDS + FLAG_FIELDS

OPERATORS: dict[str, tuple[str, ...]] = {
    "genre": ("is", "is_not", "contains"),
    "artist": ("is", "is_not", "contains"),
    "albumartist": ("is", "is_not", "contains"),
    "year": ("eq", "lt", "gt", "between"),
    "playcount": ("eq", "lt", "gt", "between"),
    "date_added": ("in_last_days", "not_in_last_days"),
    "last_played": ("in_last_days", "not_in_last_days", "never"),
    "favorite": ("is",),
}

_TOP_KEYS = frozenset({"match", "rules", "limit", "sort"})
_RULE_KEYS = frozenset({"field", "op", "value"})
_SORT_KEYS = frozenset({"field", "order"})

RuleValue = str | int | bool | tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class Rule:
    field: str
    op: str
    value: RuleValue = None


@dataclass(frozen=True, slots=True)
class Sort:
    # A name from FIELDS, or RANDOM (then `descending` means nothing).
    field: str
    descending: bool = False

    @property
    def random(self) -> bool:
        return self.field == RANDOM


DEFAULT_SORT = Sort(DEFAULT_SORT_FIELD, descending=True)


@dataclass(frozen=True, slots=True)
class Definition:
    match: str
    rules: tuple[Rule, ...]
    limit: int
    sort: Sort


@dataclass(frozen=True, slots=True)
class TrackFacts:
    """A track as the rules see it: library fields plus THIS user's plays and favourites."""

    trackhash: str
    title: str
    genres: tuple[str, ...]
    artists: tuple[str, ...]
    albumartists: tuple[str, ...]
    year: int | None
    added: int
    playcount: int
    last_played: int | None
    favorite: bool


# ---------------------------------------------------------------------------
# Parsing: a raw definition (a JSON body, or a stored row) to a checked one.
# ---------------------------------------------------------------------------


def parse_definition(raw: Mapping[str, Any]) -> Definition:
    """
    The checked definition, or a ValueError that names the part at fault.

    Unknown keys are refused too: a typo such as `"sorts"` would otherwise
    silently fall back to the default.
    """
    unknown = set(raw) - _TOP_KEYS
    if unknown:
        raise ValueError(f"unknown key(s): {', '.join(sorted(unknown))}")

    match = raw.get("match")
    if match is None:
        match = DEFAULT_MATCH
    if match not in MATCH_MODES:
        raise ValueError(f'match must be "all" or "any", not {match!r}')

    raw_rules = raw.get("rules")
    if not isinstance(raw_rules, list):
        raise ValueError("rules must be a list")
    if not raw_rules:
        raise ValueError("a smart playlist needs at least one rule")
    rules = tuple(_parse_rule(item, number) for number, item in enumerate(raw_rules, start=1))

    return Definition(
        match=match,
        rules=rules,
        limit=_parse_limit(raw.get("limit")),
        sort=_parse_sort(raw.get("sort")),
    )


def _parse_rule(item: Any, number: int) -> Rule:
    if not isinstance(item, Mapping):
        raise ValueError(f"rule {number} must be an object with field, op and value")
    unknown = set(item) - _RULE_KEYS
    if unknown:
        raise ValueError(f"rule {number}: unknown key(s): {', '.join(sorted(unknown))}")

    name = item.get("field")
    if not isinstance(name, str) or name not in OPERATORS:
        raise ValueError(f"rule {number}: unknown field {name!r} (one of: {', '.join(FIELDS)})")

    op = item.get("op")
    if op not in OPERATORS[name]:
        raise ValueError(f"rule {number}: {name} takes {', '.join(OPERATORS[name])}, not {op!r}")

    return Rule(field=name, op=op, value=_parse_value(name, op, item.get("value"), number))


def _parse_value(field: str, op: str, raw: Any, number: int) -> RuleValue:
    where = f"rule {number} ({field} {op})"

    if field in STRING_FIELDS:
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError(f"{where}: value must be a non-empty text")
        return raw.strip()

    if op == "never":
        if raw is not None:
            raise ValueError(f"{where}: takes no value")
        return None

    if field == "favorite":
        if not isinstance(raw, bool):
            raise ValueError(f"{where}: value must be true or false")
        return raw

    if op == "between":
        if not (isinstance(raw, list | tuple) and len(raw) == 2 and all(_is_count(v) for v in raw)):
            raise ValueError(f"{where}: value must be [low, high], two whole numbers")
        low, high = int(raw[0]), int(raw[1])
        if low > high:
            raise ValueError(f"{where}: low ({low}) is above high ({high})")
        return (low, high)

    if field in NUMBER_FIELDS:
        if not _is_count(raw):
            raise ValueError(f"{where}: value must be a whole number, not {raw!r}")
        return int(raw)

    # The date fields with a count of days.
    if not _is_count(raw) or raw < 1:
        raise ValueError(f"{where}: value must be a whole number of days, at least 1")
    return int(raw)


def _parse_limit(raw: Any) -> int:
    if raw is None:
        return DEFAULT_LIMIT
    if not _is_count(raw) or raw < 1 or raw > MAX_LIMIT:
        raise ValueError(f"limit must be a whole number from 1 to {MAX_LIMIT}, not {raw!r}")
    return int(raw)


def _parse_sort(raw: Any) -> Sort:
    if raw is None:
        return DEFAULT_SORT
    if raw == RANDOM:
        return Sort(RANDOM)
    if not isinstance(raw, Mapping):
        raise ValueError('sort must be "random" or {"field": <field>, "order": "asc" | "desc"}')

    unknown = set(raw) - _SORT_KEYS
    if unknown:
        raise ValueError(f"sort: unknown key(s): {', '.join(sorted(unknown))}")

    name = raw.get("field")
    if not isinstance(name, str) or name not in FIELDS:
        raise ValueError(f"sort field {name!r} is not one of: {', '.join(FIELDS)}")

    order = raw.get("order")
    if order not in ("asc", "desc"):
        raise ValueError('sort order must be "asc" or "desc"')

    return Sort(name, descending=order == "desc")


def _is_count(value: Any) -> bool:
    """A whole, non-negative number. `bool` is an int in Python, not in a rule."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def definition_to_json(defn: Definition) -> dict[str, Any]:
    """The canonical JSON form that is stored: what `parse_definition` reads back."""
    return {
        "match": defn.match,
        "rules": [{"field": r.field, "op": r.op, "value": _value_json(r.value)} for r in defn.rules],
        "limit": defn.limit,
        "sort": RANDOM
        if defn.sort.random
        else {"field": defn.sort.field, "order": "desc" if defn.sort.descending else "asc"},
    }


def _value_json(value: RuleValue) -> Any:
    return list(value) if isinstance(value, tuple) else value


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def evaluate(defn: Definition, tracks: Iterable[TrackFacts], now: int, seed: str = "") -> list[str]:
    """The trackhashes that match, in the playlist's order, cut to its limit."""
    matched = [track for track in tracks if _keeps(defn, track, now)]

    if defn.sort.random:
        # Sorted first, so the shuffle does not depend on the order the caller
        # happened to iterate the library in.
        matched.sort(key=lambda track: track.trackhash)
        random.Random(seed).shuffle(matched)
    else:
        matched = _ordered(matched, defn.sort)

    return [track.trackhash for track in matched[: defn.limit]]


def _keeps(defn: Definition, track: TrackFacts, now: int) -> bool:
    results = (_matches(rule, track, now) for rule in defn.rules)
    return all(results) if defn.match == "all" else any(results)


def _matches(rule: Rule, track: TrackFacts, now: int) -> bool:
    field = rule.field
    if field == "genre":
        return _text_matches(track.genres, rule.op, rule.value)
    if field == "artist":
        return _text_matches(track.artists, rule.op, rule.value)
    if field == "albumartist":
        return _text_matches(track.albumartists, rule.op, rule.value)
    if field == "year":
        return _count_matches(track.year, rule.op, rule.value)
    if field == "playcount":
        return _count_matches(track.playcount, rule.op, rule.value)
    if field == "date_added":
        return _date_matches(track.added, rule.op, rule.value, now)
    if field == "last_played":
        return _date_matches(track.last_played, rule.op, rule.value, now)
    # favorite: the only field left, and parsing allows only `is` with a bool.
    return track.favorite == rule.value


def _text_matches(values: tuple[str, ...], op: str, value: RuleValue) -> bool:
    wanted = str(value).casefold()
    names = [name.casefold() for name in values]
    if op == "is":
        return wanted in names
    if op == "is_not":
        return wanted not in names
    return any(wanted in name for name in names)  # contains


def _count_matches(current: int | None, op: str, value: RuleValue) -> bool:
    if current is None:
        return False
    if op == "between" and isinstance(value, tuple):
        low, high = value
        return low <= current <= high
    if not isinstance(value, int) or isinstance(value, bool):
        return False
    if op == "eq":
        return current == value
    if op == "lt":
        return current < value
    return current > value  # gt


def _date_matches(stamp: int | None, op: str, value: RuleValue, now: int) -> bool:
    if op == "never":
        return stamp is None
    recent = stamp is not None and isinstance(value, int) and stamp >= now - value * SECONDS_PER_DAY
    return recent if op == "in_last_days" else not recent


def _ordered(matched: list[TrackFacts], sort: Sort) -> list[TrackFacts]:
    # Title order first: a stable sort by the field then keeps ties in that order,
    # also for a descending sort (Python keeps equal elements in place on reverse).
    matched.sort(key=lambda track: (track.title.casefold(), track.trackhash))

    keyed = [(_sort_value(track, sort.field), track) for track in matched]
    present = [(value, track) for value, track in keyed if value is not None]
    absent = [track for value, track in keyed if value is None]

    present.sort(key=lambda pair: pair[0], reverse=sort.descending)
    return [track for _, track in present] + absent


def _sort_value(track: TrackFacts, field: str) -> str | int | None:
    if field == "genre":
        return _joined(track.genres)
    if field == "artist":
        return _joined(track.artists)
    if field == "albumartist":
        return _joined(track.albumartists)
    if field == "year":
        return track.year
    if field == "playcount":
        return track.playcount
    if field == "date_added":
        return track.added
    if field == "last_played":
        return track.last_played
    return int(track.favorite)  # favorite


def _joined(values: tuple[str, ...]) -> str | None:
    return ", ".join(value.casefold() for value in values) or None
