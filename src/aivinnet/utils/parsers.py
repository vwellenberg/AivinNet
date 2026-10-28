import re

from aivinnet.config import UserConfig
from aivinnet.enums.album_versions import AlbumVersionEnum, get_all_keywords


def split_artists(src: str, config: UserConfig):
    """
    Splits a string of artists into a list of artists, preserving those in ignoreList.
    Case-insensitive matching is used for the ignoreList.
    """
    result = []
    current = ""
    i = 0

    while i < len(src):
        # Check if any ignored artist starts at this position (case-insensitive)
        ignored_match = next(
            (
                src[i : i + len(ignored)]
                for ignored in config.artistSplitIgnoreList
                if src.lower().startswith(ignored.lower(), i)
            ),
            None,
        )

        if ignored_match:
            # If we have accumulated any current string, add it to result
            if current.strip():
                result.extend([a.strip() for a in current.split(",") if a.strip()])
                current = ""
            # Add the ignored artist to the result (preserving original case)
            result.append(ignored_match)
            # Move past the ignored artist
            i += len(ignored_match)
        elif src[i] in config.artistSeparators:
            # If we encounter a separator, process the current string
            if current.strip():
                result.extend([a.strip() for a in current.split(",") if a.strip()])
                current = ""
            i += 1
        else:
            # If it's not an ignored artist or a separator, add to current
            current += src[i]
            i += 1

    # Process any remaining current string
    if current.strip():
        result.extend([a.strip() for a in current.split(",") if a.strip()])

    return result


# A role in front of a name: "Composed by Adam Sporka". Game and film
# soundtracks put the credit into the artist tag, and since the artist hash is
# made of the whole string, the composer stood in the library twice: "Adam
# Sporka" from one album, "Composed by Adam Sporka" from the next. Deliberately
# no "written by" or "produced by": "Written by Wolves" is a band.
#
# "Lyrics by" and "Words by" came later (2026-10): KCD2 credits its songs
# "Composed by Jan Valta; Lyrics by John Comer", and the lyricist stood in the
# library as "Lyrics by John Comer". So did roles joined into one credit,
# "Music and Lyrics by X".
_ROLE = (
    r"(?:(?:(?:original\s+)?(?:music|score)\s+)?(?:composed|arranged|orchestrated|conducted|performed)"
    r"|(?:original\s+)?(?:music|score)|lyrics|words)"
)
_ROLES = rf"{_ROLE}(?:\s*(?:&|\band\b|/|,)\s*{_ROLE})*"
_ARTIST_CREDIT = re.compile(
    rf"^\s*{_ROLES}\s+by\s+(?=\S)|^\s*(?:komponiert|musik)\s+von\s+(?=\S)",
    re.IGNORECASE,
)
# A name that is nothing but roles: what is left of "Composed & Lyrics by Jan
# Valta" in front of the "&" once the artist separators have split it.
_BARE_ROLES = re.compile(rf"^\s*{_ROLES}\s*$", re.IGNORECASE)

# ⚠️ FROZEN: the rule the server applied until 2026-10. Not for cleaning
# names — only to rebuild the hashes tracks had under it, so that their
# references can follow the current rule (`Track.remember_legacy_identity`).
_ARTIST_CREDIT_UNTIL_2026_10 = re.compile(
    r"^\s*(?:(?:(?:original\s+)?(?:music|score)\s+)?(?:composed|arranged|orchestrated|conducted|performed)"
    r"|(?:original\s+)?(?:music|score))\s+by\s+(?=\S)"
    r"|^\s*(?:komponiert|musik)\s+von\s+(?=\S)",
    re.IGNORECASE,
)


def strip_artist_credit(name: str) -> str:
    """
    `name` without a leading credit: "Composed by Adam Sporka" -> "Adam Sporka".

    One name at a time, so "Composed by A; B" loses the role on A and leaves B
    alone. A name that would be empty without it keeps it. For a list of names
    as split from a tag, use `strip_artist_credits`.
    """
    stripped = _ARTIST_CREDIT.sub("", name, count=1).strip()
    return stripped or name


def strip_artist_credits(names: list[str]) -> list[str]:
    """
    The names split from one tag, each without its credit.

    The separators split "Composed & Lyrics by Jan Valta" before any credit is
    seen: "Composed" and "Lyrics by Jan Valta". A name that is only roles goes
    when the next one carries a credit — together they were one credit.
    """
    cleaned = []

    for i, name in enumerate(names):
        following = names[i + 1] if i + 1 < len(names) else ""
        if _BARE_ROLES.match(name) and _ARTIST_CREDIT.match(following):
            continue
        cleaned.append(strip_artist_credit(name))

    return cleaned


def strip_artist_credit_until_2026_10(name: str) -> str:
    """`strip_artist_credit` as it was until 2026-10 — only for rebuilding old hashes."""
    stripped = _ARTIST_CREDIT_UNTIL_2026_10.sub("", name, count=1).strip()
    return stripped or name


# A number in front of a title: "049 Saint Wenceslaus Theme", "6-001 Fistcuffs",
# "07. Intro", "1-04 - Home". The optional "6-" is the disc.
_TITLE_NUMBER = re.compile(r"(?:(?P<disc>\d{1,2})-)?(?P<num>\d{1,4})(?P<sep>\s*[.)_-]\s*|\s+)(?P<rest>\S.*)")
_LEADING_NUMBER = re.compile(r"(?:\d{1,2}-)?\d{1,4}(?!\d)")


def strip_track_number(title: str, track: int, disc: int, filepath: str = "") -> str:
    """
    `title` without a track number in front of it, when the number is one.

    Rips and game soundtracks often carry the number in the title itself
    ("049 Saint Wenceslaus Theme"): the list shows it twice, the alphabetical
    sort files the song under "0", and a search for "saint" ranked it below
    every title that merely looked like the word.

    A number alone proves nothing ("007 Theme", "3 Libras", "24-7"), so it goes
    only with a second witness:

    - it is the track's own number from the tags (with the disc, if the title
      names one), and it is zero-padded, set off by punctuation ("7. Intro") or
      carries a disc ("6-001");
    - or it is zero-padded, the tags know no other number (a file without one
      reads as track 1), and the file's name begins with the very same number.
      Unpadded, the file name is no witness: a song named after its own number
      sits in a file named after the song ("3 Libras.mp3" is track 3).

    And it must be a number in FRONT of words, not part of one: the rest has to
    contain a letter, and a separator without a space only counts after a
    padded number and before a letter — "1-Up", "24-7" and "1.5 Degrees" stay.
    """
    match = _TITLE_NUMBER.fullmatch(title)
    if not match:
        return title

    num, disc_part, sep, rest = match["num"], match["disc"], match["sep"], match["rest"]
    padded = len(num) > 1 and num.startswith("0")

    if not re.search(r"[^\W\d_]", rest):
        return title
    if not any(c.isspace() for c in sep) and not (padded and rest[0].isalpha()):
        return title

    punctuated = not sep.isspace()
    same_track = int(num) == track and (disc_part is None or int(disc_part) == disc)

    if same_track and (padded or punctuated or disc_part is not None):
        return rest.strip()

    if padded and track <= 1 and filepath:
        leading = _LEADING_NUMBER.match(filepath.rsplit("/", 1)[-1])
        token = num if disc_part is None else f"{disc_part}-{num}"
        if leading is not None and leading.group(0) == token:
            return rest.strip()

    return title


def remove_prod(title: str) -> str:
    """
    Removes the producer string in a track title using regex.
    """

    # check if title contain title, if not return it.
    if "prod." not in title.lower():
        return title

    # check if title has brackets
    if re.search(r"[()\[\]]", title):
        regex = r"\s?(\(|\[)prod\..*?(\)|\])\s?"
    else:
        regex = r"\s?\bprod\.\s*\S+"

    # remove the producer string
    title = re.sub(regex, "", title, flags=re.IGNORECASE)
    return title.strip()


def parse_feat_from_title(title: str, config: UserConfig) -> tuple[list[str], str]:
    """
    Extracts featured artists from a song title using regex.
    """
    regex = r"\((?:feat|ft|featuring|with)\.?\s+(.+?)\)"
    # regex for square brackets 👇
    sqr_regex = r"\[(?:feat|ft|featuring|with)\.?\s+(.+?)\]"

    match = re.search(regex, title, re.IGNORECASE)

    if not match:
        match = re.search(sqr_regex, title, re.IGNORECASE)
        regex = sqr_regex

    if not match:
        return [], title

    artists = match.group(1)
    artists = split_artists(artists, config)

    # remove "feat" group from title
    new_title = re.sub(regex, "", title, flags=re.IGNORECASE)
    return artists, new_title


def get_base_album_title(string: str) -> tuple[str, str | None]:
    """
    Extracts the base album title from a string.
    """
    pattern = re.compile(
        rf"\s*(\(|\[)[^\)\]]*?({get_all_keywords()})[^\)\]]*?(\)|\])$",
        re.IGNORECASE,
    )
    # TODO: Fix "Redundant character escape '\]' in RegExp "
    match = pattern.search(string)

    if match:
        removed_block = match.group(0)
        title = string.replace(removed_block, "")
        return title.strip(), removed_block.strip()

    return string, None


def get_anniversary(text: str) -> str | None:
    """
    Extracts anniversary from text using regex.
    """
    _end = "anniversary"
    match = re.search(r"\b\d+\w*(?= anniversary)", text, re.IGNORECASE)
    if match:
        return match.group(0).strip().lower() + f" {_end}"
    else:
        return _end


def get_album_info(bracket_text: str | None) -> list[str]:
    """
    Extracts album version info from the bracketed text on an album title string using regex.
    """
    if not bracket_text:
        return []

    # replace all non-alphanumeric characters with an empty string
    bracket_text = re.sub(r"[^a-zA-Z0-9\s]", "", bracket_text)
    versions = []

    for version_keywords in AlbumVersionEnum:
        for keyword in version_keywords.value:
            if re.search(keyword, bracket_text, re.IGNORECASE):
                versions.append(version_keywords.name.lower())
                break

    if "anniversary" in versions:
        anniversary = get_anniversary(bracket_text)
        versions.insert(0, anniversary)
        versions.remove("anniversary")

    return versions


def get_base_title_and_versions(original_album_title: str, get_versions=True) -> tuple[str, list[str]]:
    """
    Extracts the base album title and version info from an album title string using regex.
    """
    album_title, version_block = get_base_album_title(original_album_title)

    if version_block is None:
        return original_album_title, []

    if not get_versions:
        return album_title, []

    versions = get_album_info(version_block)

    # if no version info could be extracted, accept defeat!
    if len(versions) == 0:
        album_title = original_album_title

    return album_title, versions


def remove_bracketed_remaster(text: str):
    """
    Removes remaster info from a track title that contains brackets using regex.
    """
    return re.sub(r"\s*[\\[(][^)\]]*remaster[^)\]]*[)\]]\s*", "", text, flags=re.IGNORECASE).strip()


def remove_hyphen_remasters(text: str):
    """
    Removes remaster info from a track title that contains a hypen (-) using regex.
    """
    return re.sub(r"\s-\s*[^-]*\bremaster[^-]*\s*", "", text, flags=re.IGNORECASE).strip()


def clean_title(title: str) -> str:
    """
    Removes remaster info from a track title using regex.
    """
    if "remaster" not in title.lower():
        return title

    rem_1 = remove_bracketed_remaster(title)
    rem_2 = remove_hyphen_remasters(title)

    return rem_1 if len(rem_2) > len(rem_1) else rem_2


def tag_int(value: object, default: int) -> int:
    """
    Read a number out of a raw tag value from `Track.extra`, or `default`.

    `extra` holds whatever the tag reader handed over, and its shape changed:
    tinytag 1 gave plain numbers, tinytag 2's `as_dict()` gives every field as
    a LIST of strings (`track_total: ["12"]`). Rows from both eras sit side by
    side in one library, so a bare `int(...)` raises on the newer ones — that
    500'd the album page for every album whose files carry "track 1/12".
    """
    if isinstance(value, list):
        value = value[0] if value else None

    if isinstance(value, bool):
        return default

    if isinstance(value, int):
        return value

    if isinstance(value, str):
        # Some writers keep the "n/total" form even in a total field.
        value = value.split("/", 1)[0].strip()

        # isdecimal, not isdigit: "²" is a digit that int() rejects.
        if value.isdecimal():
            return int(value)

    return default
