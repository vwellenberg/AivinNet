"""
Read a track number and a title out of a file name.

⚠️ **This is not a fallback for MusicBrainz — for a whole class of albums it is
the only source there is.** Measured on this library: "The Guild 2", 94 tracks,
every file tagged `track 1` with the number as its title ("68", "66", "25"),
while the file names carry the real ones ("68. Night Woods1.mp3"). MusicBrainz
answers **zero** candidates for it and for "Die Gilde 2" — a game soundtrack rip
is not in their database and never will be. A metadata feature that only asks
MusicBrainz cannot repair that album at all.

So the file name is a first-class source, and the honest description of it is:
the numbering is almost always right, and the title is right as often as
whoever named the files was careful.
"""

from __future__ import annotations

import os
import re

# A leading track number: "68. ", "01 - ", "1_", "03.". The separator is
# required — without it "1984 Suite.mp3" would lose its year to the number.
_LEADING_NUMBER = re.compile(r"^\s*(\d{1,3})\s*[.\-_)\]]\s*")

# "Artist - 01 - Title": the number is in the middle, and everything before it
# is the artist rather than part of the title.
_ARTIST_THEN_NUMBER = re.compile(r"^\s*(?P<artist>.+?)\s+[-–—]\s+(?P<num>\d{1,3})\s*[.\-_]?\s+(?P<rest>.+)$")

# ⚠️ A placeholder can be IN the file name too ("Genesis - 03 - Track 3.ogg").
# Checking only the start of the string misses the common case: the rule in
# `.claude/rules/track-tags.md` records 53 files whose placeholder sat at the
# END. Both ends are checked here.
_PLACEHOLDER = re.compile(r"^(track|spur|titel|audiotrack)\s*\d*$|\b(track|spur|titel)\s*\d+\s*$", re.IGNORECASE)

# Underscores as word separators, and runs of whitespace left by the stripping.
_UNDERSCORES = re.compile(r"_+")
_SPACES = re.compile(r"\s{2,}")


def _clean(title: str) -> str:
    title = _UNDERSCORES.sub(" ", title)
    title = _SPACES.sub(" ", title)
    return title.strip(" -–—_.")


def looks_like_placeholder(title: str) -> bool:
    """True for "Track 07", "Titel 3", "audiotrack01" and friends."""
    return bool(_PLACEHOLDER.match((title or "").strip()))


def parse(filepath: str) -> tuple[int | None, str | None]:
    """
    Pull (track number, title) out of a path. Either may be None.

    A None means "this file name does not say", which is different from "it says
    something empty" — the caller must not write either, but only the first is
    worth reporting as a normal outcome.
    """
    if not filepath:
        return None, None

    base = os.path.basename(filepath)
    stem, extension = os.path.splitext(base)

    # ⚠️ `splitext(".mp3")` is `(".mp3", "")`, not `("", ".mp3")` — a dotfile has
    # no extension as far as it is concerned. Without this, a file called
    # `.mp3` proposed the title "mp3".
    if not extension and base.startswith("."):
        return None, None

    if not stem.strip():
        return None, None

    number: int | None = None
    rest = stem

    middle = _ARTIST_THEN_NUMBER.match(stem)
    if middle:
        number = int(middle.group("num"))
        rest = middle.group("rest")
    else:
        leading = _LEADING_NUMBER.match(stem)
        if leading:
            number = int(leading.group(1))
            rest = stem[leading.end() :]

    title = _clean(rest)
    if not title or looks_like_placeholder(title):
        title = None

    return number, title
