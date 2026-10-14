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
_ARTIST_CREDIT = re.compile(
    r"^\s*(?:(?:(?:original\s+)?(?:music|score)\s+)?(?:composed|arranged|orchestrated|conducted|performed)"
    r"|(?:original\s+)?(?:music|score))\s+by\s+(?=\S)"
    r"|^\s*(?:komponiert|musik)\s+von\s+(?=\S)",
    re.IGNORECASE,
)


def strip_artist_credit(name: str) -> str:
    """
    `name` without a leading credit: "Composed by Adam Sporka" -> "Adam Sporka".

    Applied to each name after the split, so "Composed by A; B" loses the role
    on A and leaves B alone. A name that would be empty without it keeps it.
    """
    stripped = _ARTIST_CREDIT.sub("", name, count=1).strip()
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

    A number alone proves nothing ("007 Theme", "7 Seconds", "24-7"), so it
    goes only with a second witness:

    - it is the track's own number from the tags (with the disc, if the title
      names one), and it is zero-padded or set off by punctuation ("7. Intro");
    - or the file's name begins with the very same number, so the title was made
      from the file name or copied from it: with the track's own number even
      unpadded ("14 swamp camp.mp3", track 14), and zero-padded when the tags
      know no other number. A file without one reads as track 1; a different
      one means the "007" in "007 Theme" is part of the name.
    """
    match = _TITLE_NUMBER.fullmatch(title)
    if not match or not re.search(r"\w", match["rest"]):
        return title

    num, disc_part = match["num"], match["disc"]
    padded = len(num) > 1 and num.startswith("0")
    punctuated = not match["sep"].isspace()
    same_track = int(num) == track and (disc_part is None or int(disc_part) == disc)

    if same_track and (padded or punctuated or disc_part is not None):
        return match["rest"].strip()

    leading = _LEADING_NUMBER.match(filepath.rsplit("/", 1)[-1])
    token = num if disc_part is None else f"{disc_part}-{num}"
    named_so = leading is not None and leading.group(0) == token

    if named_so and (same_track or (padded and track <= 1)):
        return match["rest"].strip()

    return title

    num, disc_part = match["num"], match["disc"]
    padded = len(num) > 1 and num.startswith("0")
    punctuated = not match["sep"].isspace()

    same_track = int(num) == track and (disc_part is None or int(disc_part) == disc)
    if same_track and (padded or punctuated or disc_part is not None):
        return match["rest"].strip()

    if padded and filepath and track <= 1:
        stem = filepath.rsplit("/", 1)[-1]
        leading = _LEADING_NUMBER.match(stem)
        token = f"{disc_part}-{num}" if disc_part is not None else num
        if leading and leading.group(0) == token:
            return match["rest"].strip()

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
