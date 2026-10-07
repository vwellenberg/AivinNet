"""
A small library with the shapes a real one has, for end-to-end checks of a
running server: the CI Docker smoke test and the release update tests.

Every folder of the earlier test music held exactly one album, so the path that
broke Home in 2026.10.2 — a folder holding two albums (#388) — was never taken.
This library has that shape and the others a real collection brings: a double
album in CD folders, a compilation, a "feat." credit, an artist shared between
albums, non-Latin names, the same song twice, a file without tags and a deep
folder. The files are silent MP3s of about a second, made here, so nothing
binary lives in git.

Usage: python3 e2e/make_library.py <target dir>      (needs mutagen)
"""

import sys
from pathlib import Path

from mutagen.id3 import ID3, TALB, TDRC, TIT2, TPE1, TPE2, TPOS, TRCK

# One MPEG-1 Layer III frame, 128 kbps, 44.1 kHz, mono, all zero: silence. A
# real frame header, so every tag reader sees audio with a bitrate and a length.
FRAME = bytes([0xFF, 0xFB, 0x90, 0xC4]) + bytes(413)
FRAMES_PER_SECOND = 39

# path -> tags (None: a file with no tags at all)
LIBRARY: dict[str, dict | None] = {}


def album(folder: str, name: str, artist: str, titles: list[str], year: str = "2019", disc: str | None = None):
    for i, title in enumerate(titles, start=1):
        LIBRARY[f"{folder}/{i:02} - {title}.mp3"] = {
            "title": title,
            "album": name,
            "artist": artist,
            "albumartist": artist,
            "track": str(i),
            "disc": disc,
            "date": year,
        }


album("Albums/Northern Lights/Aurora (2019)", "Aurora", "Northern Lights", ["Dawn", "Noon", "Dusk"])
album("Albums/The Twins/Two Sides/CD1", "Two Sides", "The Twins", ["Left", "Right"], disc="1/2")
album("Albums/The Twins/Two Sides/CD2", "Two Sides", "The Twins", ["Up", "Down"], disc="2/2")

# A compilation: one album artist, different performers — one of them also has
# an album of their own, and one is a "feat." credit.
for i, (title, artist) in enumerate(
    [("Wave", "Coastline"), ("Drift", "Breeze feat. Cloud"), ("Glow", "Northern Lights")], start=1
):
    LIBRARY[f"Compilations/Summer Hits/{i:02} - {title}.mp3"] = {
        "title": title,
        "album": "Summer Hits",
        "artist": artist,
        "albumartist": "Various Artists",
        "track": str(i),
        "date": "2020",
    }

# ONE folder, TWO albums: what Home shows as a folder row (#388).
for name, title, alb, artist in [
    ("Rain", "Rain", "Weather", "Skyline"),
    ("Fog", "Fog", "Weather", "Skyline"),
    ("Snow", "Snow", "Seasons", "Frost"),
]:
    LIBRARY[f"Mixed/{name}.mp3"] = {"title": title, "album": alb, "artist": artist, "albumartist": artist}

# Names outside ASCII, in the paths too.
album("Ünïcode/Sigur Rós/Takk", "Takk", "Sigur Rós", ["Hoppípolla"])
album("Ünïcode/YOASOBI/夜に駆ける", "夜に駆ける", "YOASOBI", ["夜に駆ける"])
album("Ünïcode/Café Tacvba/Re", "Re", "Café Tacvba", ["Las Flores"])

# The same song twice: two files, one trackhash.
for path in ("Duplicates/Echo.mp3", "Duplicates/again/Echo.mp3"):
    LIBRARY[path] = {"title": "Echo", "album": "Repeat", "artist": "Mirror", "albumartist": "Mirror"}

LIBRARY["Untagged/Just A File.mp3"] = None
album("Deep/a/b/c/d", "Depth", "Diver", ["Bottom"])


def write(path: Path, tags: dict | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(FRAME * FRAMES_PER_SECOND)
    if tags is None:
        return

    id3 = ID3()
    id3.add(TIT2(encoding=3, text=tags["title"]))
    id3.add(TALB(encoding=3, text=tags["album"]))
    id3.add(TPE1(encoding=3, text=tags["artist"]))
    id3.add(TPE2(encoding=3, text=tags["albumartist"]))
    if tags.get("track"):
        id3.add(TRCK(encoding=3, text=tags["track"]))
    if tags.get("disc"):
        id3.add(TPOS(encoding=3, text=tags["disc"]))
    if tags.get("date"):
        id3.add(TDRC(encoding=3, text=tags["date"]))
    id3.save(path)


def main(target: str) -> None:
    root = Path(target)
    for rel, tags in LIBRARY.items():
        write(root / rel, tags)
    print(f"{len(LIBRARY)} files in {root}")


if __name__ == "__main__":
    main(sys.argv[1])
