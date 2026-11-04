"""Generate a fictional, reproducible music library for README screenshots (#713).

Every name, title and cover here is invented. Audio is synthesized with ffmpeg,
covers are drawn with Pillow, tags are written with mutagen. The same command
always produces the same bytes (fixed seed, no timestamps in the files).

Usage (from the repository root):

    uv run --frozen python scripts/demo/make_library.py <outdir>
"""

from __future__ import annotations

import argparse
import random
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from mutagen.id3 import APIC, COMM, ID3, TALB, TCMP, TCON, TDRC, TIT2, TPE1, TPE2, TPOS, TRCK
from mutagen.mp3 import MP3
from PIL import Image, ImageDraw, ImageFont

SEED = 713
COVER_SIZE = 800
AUDIO_RATE = 44100
MP3_BITRATE = "64k"
VARIOUS = "Various Artists"

# Fictional names only. Checked against well-known acts: none of these is meant to
# be a real artist. The ones that sound like they could be are deliberately odd.
WORDS_A = [
    "Amber", "Quiet", "Hollow", "Silver", "Northern", "Paper", "Velvet", "Glass", "Low",
    "Early", "Copper", "Distant", "Lantern", "Salt", "Pale", "Winter", "Harbour", "Fading",
    "Golden", "Static", "Wild", "Slow", "Morning", "Electric", "Cobalt", "Midnight",
]  # fmt: skip
WORDS_B = [
    "Tide", "Garden", "Engine", "Window", "Orchard", "Ferry", "Signal", "Thread", "Bridge",
    "Lantern", "Harbour", "Mirror", "Rail", "Meadow", "Pier", "Circuit", "Field", "Season",
    "Stair", "Compass", "Kite", "Parade", "Lagoon", "Drift", "Choir", "Shore", "Garden",
]  # fmt: skip
TITLE_NOUNS = [
    "Tide", "Harbour", "Lantern", "Rain", "Ferry", "Coast", "Window", "Engine", "Night",
    "Signal", "Orchard", "Ledger", "Canal", "Rooftop", "Compass", "Meadow", "Pier", "Static",
    "Smoke", "Echo", "Parade", "Glass", "Sunday", "Letter", "River", "Garden", "Kite",
]  # fmt: skip
TITLE_FRAMES = [
    "{n}", "The {n}", "{n} Over the {m}", "Last {n}", "{n} Between Stations",
    "Slow {n}", "{n} for {m}", "Under the {n}", "Nothing Like a {n}", "{n} Again",
    "Dust on the {n}", "Halfway to {m}", "The Long {n}", "Something About {m}",
]  # fmt: skip


@dataclass
class Track:
    title: str
    artist: str | None = None  # None: the album artist
    genre: str = ""
    duration: int = 30


@dataclass
class Album:
    artist: str
    title: str
    year: int
    genre: str
    cover: bool = True
    palette: tuple[str, str, str] = ("#222222", "#dddddd", "#ff6600")
    tracks: list[Track] = field(default_factory=list)
    compilation: bool = False


# Christmas tracks are named by title and genre so the Christmas station finds them.
CHRISTMAS_TITLES = [
    "Snow Over the Harbour",
    "Lantern Bells for Ada",
    "Carol of the Low Tide",
    "Frost on the Ferry Rail",
    "Bells Across the Quay",
]
CHORAL_TITLES = ["Evening Canticle", "Three Voices in the Nave", "Hymn for the Long Night"]
# The Christmas station needs SEASON_MIN_TRACKS (5) Christmas tracks, so five here.
CHRISTMAS_COUNT = len(CHRISTMAS_TITLES)

# (artist, album, year, genre, has_cover, palette, track count, track artist overrides)
ALBUM_SPECS = [
    ("Neon Lagoon", "Chrome Coastline", 1984, "Synthwave", True, ("#0b0f2a", "#f4f1ff", "#ff3fa4"), 8),
    ("Neon Lagoon", "Night Freight", 2021, "Synthwave", True, ("#1b0d24", "#ffe9b3", "#27d7c4"), 7),
    ("Marta Kessler Trio", "Quiet Arithmetic", 1974, "Jazz", True, ("#2b1d12", "#f3e3c3", "#d9822b"), 8),
    ("Marta Kessler Trio", "Blue Hour Sessions", 2019, "Jazz", True, ("#0d2233", "#cfe8f5", "#4ab3d9"), 7),
    ("The Paper Kites of Ostend", "Paper Weather", 2009, "Indie", True, ("#e9e4da", "#2d2a26", "#c94c3a"), 9),
    ("Cobalt Parade", "Hello Static", 2014, "Indie", True, ("#14213d", "#fca311", "#e5e5e5"), 8),
    ("Halcyon Drift", "Hollow Meridian", 2016, "Ambient", True, ("#081c15", "#b7e4c7", "#2d6a4f"), 6),
    ("Velvet Orchard", "Sunday Pressure", 1977, "Funk", True, ("#3d0c02", "#ffd166", "#ef476f"), 8),
    ("Velvet Orchard", "Pocket Weather", 2023, "Funk", True, ("#101820", "#fee715", "#f08a24"), 7),
    ("Tin Lantern Club", "Concrete Psalms", 1994, "Hip Hop", True, ("#1a1a1a", "#e0e0e0", "#b08968"), 8),
    ("Mira Solenne", "Glasshouse Suite", 1982, "Classical", True, ("#f7f3ea", "#3a3a4a", "#8c6d46"), 6),
    ("Ondine Sky", "Small Hours Folk", 1971, "Folk", False, ("#5b4636", "#f5e6c8", "#a7bfa0"), 7),
    ("The Lantern Sisters", "Harvest Rope", 2024, "Folk", True, ("#4a3b2a", "#f8efd8", "#7fa650"), 7),
    ("Northwind Choir", "Winter Harbour Carols", 2017, "Choral", True, ("#0a1f33", "#eef6ff", "#f2c14e"), 7),
]  # fmt: skip

COMPILATION = ("Various Artists", "Harbour Mixtape 01", 2020, ("#262626", "#fafafa", "#ffb703"), 10)

COMPILATION_ARTISTS = [
    "Neon Lagoon", "Marta Kessler Trio", "Cobalt Parade", "Halcyon Drift", "Velvet Orchard",
    "Tin Lantern Club", "The Lantern Sisters", "Mira Solenne", "Ondine Sky", "Northwind Choir",
]  # fmt: skip


def sanitize(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def make_title(rng: random.Random, used: set[str]) -> str:
    for _ in range(200):
        frame = rng.choice(TITLE_FRAMES)
        title = frame.format(n=rng.choice(TITLE_NOUNS), m=rng.choice(TITLE_NOUNS))
        if title not in used:
            used.add(title)
            return title
    raise RuntimeError("could not find a unique title")


def build_albums(rng: random.Random) -> list[Album]:
    albums: list[Album] = []
    for artist, title, year, genre, has_cover, palette, count in ALBUM_SPECS:
        used: set[str] = set()
        tracks: list[Track] = []
        for i in range(count):
            track_genre = genre
            track_title = make_title(rng, used)
            if genre == "Choral" and i < CHRISTMAS_COUNT:
                track_genre = "Christmas"
                track_title = CHRISTMAS_TITLES[i]
            elif genre == "Choral":
                track_title = (
                    CHORAL_TITLES[i - CHRISTMAS_COUNT] if i - CHRISTMAS_COUNT < len(CHORAL_TITLES) else track_title
                )
            artist_name = None
            if artist == "Cobalt Parade" and i == 2:
                artist_name = "Cobalt Parade feat. Ada Rune"
            if artist == "Tin Lantern Club" and i == 5:
                artist_name = "Tin Lantern Club feat. Sol Verane"
            tracks.append(
                Track(
                    title=track_title,
                    artist=artist_name,
                    genre=track_genre,
                    duration=rng.randint(20, 40),
                )
            )
        albums.append(Album(artist, title, year, genre, has_cover, palette, tracks))

    # One compilation: mixed track artists, album artist "Various Artists".
    c_artist, c_title, c_year, c_palette, c_count = COMPILATION
    tracks = []
    used: set[str] = set()
    for i in range(c_count):
        tracks.append(
            Track(
                title=make_title(rng, used),
                artist=COMPILATION_ARTISTS[i % len(COMPILATION_ARTISTS)],
                genre="Mixtape",
                duration=rng.randint(20, 40),
            )
        )
    albums.append(Album(c_artist, c_title, c_year, "Mixtape", True, c_palette, tracks, compilation=True))
    return albums


def draw_cover(album: Album, rng: random.Random) -> Image.Image:
    """Bold shapes over a vertical gradient, with the title set large. Seeded per album."""
    size = COVER_SIZE
    bg_hex, fg_hex, accent_hex = album.palette
    bg = _rgb(bg_hex)
    fg = _rgb(fg_hex)
    accent = _rgb(accent_hex)

    img = Image.new("RGB", (size, size), bg)
    draw = ImageDraw.Draw(img)
    # Gradient: lighten the background from top to bottom.
    for y in range(size):
        t = y / (size - 1)
        col = tuple(int(bg[k] * (1 - 0.35 * t) + fg[k] * 0.35 * t) for k in range(3))
        draw.line([(0, y), (size, y)], fill=col)

    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for _ in range(rng.randint(4, 6)):
        kind = rng.choice(["circle", "rect", "tri"])
        x0, y0 = rng.randint(-100, size - 100), rng.randint(-100, size - 100)
        s = rng.randint(180, 520)
        color = (*(accent if rng.random() < 0.6 else fg), rng.randint(120, 230))
        if kind == "circle":
            odraw.ellipse([x0, y0, x0 + s, y0 + s], fill=color)
        elif kind == "rect":
            odraw.rectangle([x0, y0, x0 + s, y0 + int(s * 0.4)], fill=color)
        else:
            odraw.polygon([(x0, y0 + s), (x0 + s // 2, y0), (x0 + s, y0 + s)], fill=color)
    img = Image.alpha_composite(img.convert("RGBA"), overlay)

    title_draw = ImageDraw.Draw(img)
    font = _font(104)
    lines = _wrap(album.title, 9)
    line_h = 116
    top = size - 60 - line_h * len(lines)
    for i, line in enumerate(lines):
        bbox = title_draw.textbbox((0, 0), line, font=font)
        w = bbox[2] - bbox[0]
        # A dark stroke keeps the title readable over bright shapes.
        title_draw.text(
            ((size - w) / 2, top + i * line_h),
            line,
            font=font,
            fill=fg,
            stroke_width=6,
            stroke_fill=bg,
        )
    return img.convert("RGB")


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    # Pillow >= 10.1 ships a scalable default font; the size argument is honoured.
    return ImageFont.load_default(size=size)


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def synth_audio(path: Path, seconds: int, rng: random.Random) -> None:
    """A slow chord with fade in/out, rendered by ffmpeg. Different per track via the seed."""
    root = rng.choice([110, 123.47, 130.81, 146.83, 164.81, 174.61])
    partials = [root, root * rng.choice([1.25, 1.5]), root * 2 * rng.choice([1.0, 1.2599, 1.4983])]
    expr = "+".join(f"{w}*sin(2*PI*{f:.3f}*t)" for w, f in zip([0.22, 0.16, 0.10], partials, strict=True))
    filt = (
        f"aevalsrc='({expr})*min(1,t/1.5)*min(1,({seconds}-t)/2.0)'"
        f":s={AUDIO_RATE}:d={seconds}"
    )  # fmt: skip
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            filt,
            "-ac",
            "2",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            MP3_BITRATE,
            "-write_xing",
            "1",
            "-map_metadata",
            "-1",
            str(path),
        ],
        check=True,
    )


def tag_mp3(path: Path, album: Album, track: Track, number: int, cover_jpg: bytes | None) -> None:
    audio = MP3(path)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    assert isinstance(tags, ID3)
    tags.delall("APIC")
    tags.add(TIT2(encoding=3, text=track.title))
    tags.add(TPE1(encoding=3, text=track.artist or album.artist))
    tags.add(TPE2(encoding=3, text=album.artist))
    tags.add(TALB(encoding=3, text=album.title))
    tags.add(TDRC(encoding=3, text=str(album.year)))
    tags.add(TCON(encoding=3, text=track.genre))
    tags.add(TRCK(encoding=3, text=f"{number}/{len(album.tracks)}"))
    tags.add(TPOS(encoding=3, text="1"))
    if album.compilation:
        tags.add(TCMP(encoding=3, text="1"))
    tags.add(COMM(encoding=3, lang="eng", desc="", text="Synthetic demo audio"))
    if cover_jpg is not None:
        tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_jpg))
    audio.save(v2_version=3)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("outdir", type=Path, help="Folder to write the library into (replaced if it exists)")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print("ffmpeg is required on PATH", file=sys.stderr)
        return 1

    out: Path = args.outdir.resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    rng = random.Random(SEED)
    albums = build_albums(rng)
    total_tracks = 0

    for album in albums:
        folder = out / sanitize(album.artist) / f"{album.year} - {sanitize(album.title)}"
        folder.mkdir(parents=True)

        cover_jpg: bytes | None = None
        if album.cover:
            cover_rng = random.Random(f"{SEED}:{album.title}")
            image = draw_cover(album, cover_rng)
            cover_path = folder / "cover.jpg"
            image.save(cover_path, "JPEG", quality=92)
            cover_jpg = cover_path.read_bytes()

        for number, track in enumerate(album.tracks, start=1):
            track_rng = random.Random(f"{SEED}:{album.title}:{number}")
            target = folder / f"{number:02d} {sanitize(track.title)}.mp3"
            synth_audio(target, track.duration, track_rng)
            tag_mp3(target, album, track, number, cover_jpg)
            total_tracks += 1

    artists = {a.artist for a in albums} | {t.artist.split(" feat.")[0] for a in albums for t in a.tracks if t.artist}
    print(f"{len(albums)} albums, {total_tracks} tracks, {len(artists)} artists -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
