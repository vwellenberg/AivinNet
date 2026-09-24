"""
What a track's file should be called, worked out from its tags (#144).

Pure: no filesystem, no stores. The caller passes in what is on disk (the names
already taken in a folder), and gets back a plan it can show before anything
moves. The same plan is recomputed when the person confirms, so what the
preview promised is what gets checked for conflicts again at write time.

The pattern is ``NN - Title.ext`` — or ``D-NN - Title.ext`` on an album with
more than one disc, because two discs both have a track 1. A track without a
number is just ``Title.ext``.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

# Characters no file name may carry on at least one of the systems these files
# end up on (Linux forbids only "/" and NUL; Windows, macOS and SMB shares the
# rest). A library copied to a USB stick or opened over the network must still
# work, so the strictest set wins.
#
# The separators become a hyphen rather than vanishing: "AC/DC" should read as
# "AC-DC", not "ACDC". The rest carry no meaning a reader would miss.
_SEPARATORS = re.compile(r"[/\\]")
_COLON_SPACE = re.compile(r"\s*:\s+")
_DROPPED = re.compile(r'[:*?"<>|\x00-\x1f\x7f]')
_SPACES = re.compile(r"\s+")

# Names Windows reserves for devices. A file called "CON.mp3" cannot be created
# or deleted there. Only reachable here for an unnumbered track.
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}

# ⚠️ Bytes, not characters. Linux, ext4 and most other file systems cap a NAME
# at 255 BYTES, and a title in Japanese or with many accents is two to three
# bytes a character. Some headroom stays for a disc prefix and a long suffix.
MAX_NAME_BYTES = 240


def clean_title(title: str) -> str:
    """
    A title made safe to be a file name. Empty when nothing usable is left.

    ⚠️ A leading dot is stripped, and it is not cosmetic: the indexer treats a
    dot-file as hidden and skips it (track-tags.md, the band called
    "...Und Null Sekunden"). A title that renamed its file to ".Something.mp3"
    would take the track out of the library without an error anywhere.
    """
    # Whitespace first: a tab or line break is a word gap, and the control
    # characters dropped below would otherwise glue the words together.
    name = _SPACES.sub(" ", title)
    name = _SEPARATORS.sub("-", name)
    # "Star Trek: The Motion Picture" -> "Star Trek - The Motion Picture". A
    # bare colon inside a word ("5:15") just goes.
    name = _COLON_SPACE.sub(" - ", name)
    name = _DROPPED.sub("", name)
    name = _SPACES.sub(" ", name).strip()
    # Windows silently drops trailing dots and spaces, which would make two
    # different names the same file there.
    name = name.strip(" .").lstrip(".")
    return name


def _truncate_utf8(text: str, max_bytes: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    # `ignore` drops a character cut in half rather than leaving a broken byte.
    return encoded[:max_bytes].decode("utf-8", "ignore").rstrip(" .")


def number_width(track_numbers: list[int]) -> int:
    """Two digits, or more when the album has track 100 and up — so it sorts."""
    highest = max((n for n in track_numbers if n and n > 0), default=0)
    return max(2, len(str(highest)))


def target_name(
    title: str | None,
    track: int | None,
    disc: int | None,
    suffix: str,
    *,
    width: int = 2,
    multi_disc: bool = False,
) -> str | None:
    """
    The file name for one track, or None when its tags cannot name it.

    `suffix` is kept exactly as it is on disk (".mp3", ".FLAC"): this renames a
    file, it does not change what the file is.
    """
    cleaned = clean_title(title or "")
    if not cleaned:
        return None

    prefix = ""
    if track and track > 0:
        prefix = f"{track:0{width}d}"
        if multi_disc and disc and disc > 0:
            prefix = f"{disc}-{prefix}"

    budget = MAX_NAME_BYTES - len(suffix.encode("utf-8")) - len((prefix + " - ").encode("utf-8"))
    cleaned = _truncate_utf8(cleaned, budget)
    if not cleaned:
        return None

    if not prefix and cleaned.lower() in _RESERVED:
        cleaned += "_"

    return f"{prefix} - {cleaned}{suffix}" if prefix else f"{cleaned}{suffix}"


# ---------------------------------------------------------------------------
# Planning a batch
# ---------------------------------------------------------------------------

UNCHANGED = "unchanged"
RENAME = "rename"
CONFLICT = "conflict"
NO_NAME = "no-name"


@dataclass(frozen=True)
class Planned:
    filepath: str
    target: str | None
    """The new BASENAME, or None when there is nothing to move to."""
    status: str

    @property
    def target_path(self) -> str | None:
        return os.path.join(os.path.dirname(self.filepath), self.target) if self.target else None


def plan(wanted: list[tuple[str, str | None]], occupied: dict[str, set[str]]) -> list[Planned]:
    """
    Decide, for each ``(filepath, wanted basename)``, whether it can move.

    `occupied` maps each folder to the names already in it on disk. A file is
    never moved onto a name that is taken — with one exception worked out here:
    a name that is taken by ANOTHER file of this batch, which is itself moving
    away first. Renumbering an album is exactly that ("02 - B" becomes
    "03 - B" while "03 - C" becomes "04 - C"), so refusing it would refuse the
    common case.

    What is left after that is a conflict and is not moved at all:

    - the name belongs to a file outside the batch (nothing is overwritten);
    - two files of the batch want the same name (neither gets it — picking
      one would be a silent guess about which file is the real track);
    - a cycle ("A" <-> "B"), which no order of plain renames can do without a
      temporary name, and a temporary name is a file that can be left behind.
    """
    by_path = {path: name for path, name in wanted}
    result: dict[str, Planned] = {}

    # ⚠️ Names are compared WITHOUT case. On ext4 "01 - Intro.mp3" and
    # "01 - intro.mp3" are two files; copied to a USB stick, an SMB share or a
    # Mac they are one, and the second overwrites the first. The strictest
    # file system wins here too.

    # Two files asking for the same name in the same folder.
    claims: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for path, name in wanted:
        if name is None:
            result[path] = Planned(path, None, NO_NAME)
        elif name == os.path.basename(path):
            result[path] = Planned(path, name, UNCHANGED)
        else:
            claims.setdefault((os.path.dirname(path), name.lower()), []).append((path, name))

    pending: dict[str, str] = {}
    for entries in claims.values():
        if len(entries) > 1:
            for path, name in entries:
                result[path] = Planned(path, name, CONFLICT)
        else:
            path, name = entries[0]
            pending[path] = name

    # Simulate the moves on a copy of what is on disk: move whatever has a free
    # target, repeat. Whatever never gets a free target is a conflict.
    taken = {folder: {name.lower() for name in names} for folder, names in occupied.items()}
    moved = True
    while pending and moved:
        moved = False
        for path, name in list(pending.items()):
            folder = os.path.dirname(path)
            names = taken.setdefault(folder, set())
            own = os.path.basename(path).lower()
            # A case-only rename ("track.mp3" -> "Track.mp3") lands on its own
            # name; anything else that is taken is someone else's file.
            if name.lower() in names and name.lower() != own:
                continue
            names.discard(own)
            names.add(name.lower())
            result[path] = Planned(path, name, RENAME)
            del pending[path]
            moved = True

    for path, name in pending.items():
        result[path] = Planned(path, name, CONFLICT)

    return [result[path] for path in by_path]
