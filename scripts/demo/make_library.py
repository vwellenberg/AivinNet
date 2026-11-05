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


# Bright, flat colour sets that sit well next to the app's own Memphis palette.
# (background, shape, shape, text). Each album picks one by its title, so the
# grid reads as a set without two neighbours looking alike.
COVER_SETS = [
    ("#F5B23C", "#E2574C", "#2FBFA3", "#17171A"),
    ("#2FBFA3", "#F2799F", "#F5D547", "#17171A"),
    ("#8B8BEB", "#F5B23C", "#F4F2ED", "#17171A"),
    ("#E2574C", "#F5D547", "#17171A", "#F4F2ED"),
    ("#F2799F", "#3B82D9", "#F5B23C", "#17171A"),
    ("#3B82D9", "#F5D547", "#F2799F", "#F4F2ED"),
    ("#8CC63F", "#8B8BEB", "#E2574C", "#17171A"),
    ("#17171A", "#2FBFA3", "#F2799F", "#F4F2ED"),
    ("#F4F2ED", "#E2574C", "#3B82D9", "#17171A"),
    ("#C36BBE", "#F5B23C", "#2FBFA3", "#F4F2ED"),
    ("#B08850", "#F4F2ED", "#E2574C", "#17171A"),
    ("#3EBFAF", "#17171A", "#F5B23C", "#17171A"),
]
INK = (23, 23, 26)


def draw_cover(album: Album, rng: random.Random) -> Image.Image:
    """Flat colour, a few bold shapes with an ink outline, and the title set large. Seeded per album."""
    size = COVER_SIZE
    index = sum(ord(c) for c in album.title) % len(COVER_SETS)
    bg_hex, a_hex, b_hex, text_hex = COVER_SETS[index]
    bg, shape_a, shape_b, text = _rgb(bg_hex), _rgb(a_hex), _rgb(b_hex), _rgb(text_hex)

    img = Image.new("RGB", (size, size), bg)
    draw = ImageDraw.Draw(img)
    # A faint dot grid, like the app's halftone.
    for y in range(20, size, 40):
        for x in range(20, size, 40):
            draw.ellipse([x - 3, y - 3, x + 3, y + 3], fill=_mix(bg, text, 0.12))

    # The title sits at the bottom, the artist at the top left: the shapes keep
    # to the band in between, right of the artist line, so neither is covered.
    lines = _wrap(album.title, 11)
    line_h = 118
    top = size - 70 - line_h * len(lines)
    band_top, band_bottom = 120, top - 30
    for i in range(rng.randint(3, 4)):
        kind = rng.choice(["circle", "rect", "tri", "zigzag"])
        colour = shape_a if i % 2 == 0 else shape_b
        s = rng.randint(150, max(160, min(320, band_bottom - band_top)))
        h = int(s * 0.45) if kind == "rect" else (s // 4 if kind == "zigzag" else s)
        x0 = rng.randint(120, size - s - 30)
        y0 = rng.randint(band_top, max(band_top, band_bottom - h))
        if kind == "circle":
            draw.ellipse([x0, y0, x0 + s, y0 + s], fill=colour, outline=INK, width=10)
        elif kind == "rect":
            draw.rectangle([x0, y0, x0 + s, y0 + h], fill=colour, outline=INK, width=10)
        elif kind == "tri":
            draw.polygon([(x0, y0 + s), (x0 + s // 2, y0), (x0 + s, y0 + s)], fill=colour, outline=INK, width=10)
        else:
            points = [(x0 + k * s // 5, y0 + (0 if k % 2 == 0 else h)) for k in range(6)]
            draw.line(points, fill=INK, width=34, joint="curve")
            draw.line(points, fill=colour, width=20, joint="curve")

    font = _font(112)
    for i, line in enumerate(lines):
        draw.text(
            (56, top + i * line_h), line, font=font, fill=text, stroke_width=4 if text != INK else 0, stroke_fill=INK
        )
    small = _font(40)
    draw.text((60, 52), album.artist.upper(), font=small, fill=text)
    return img


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (int(a[0] + (b[0] - a[0]) * t), int(a[1] + (b[1] - a[1]) * t), int(a[2] + (b[2] - a[2]) * t))


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


# A heavy face where the system has one; otherwise Pillow's scalable default.
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf",
    "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
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


# Two albums carry synced lyrics (.lrc beside each track), so the lyrics view has
# something to show. The lines are invented, like everything else here.
LYRIC_ALBUMS = {"Chrome Coastline", "Pocket Weather"}
LYRIC_LINES = [
    "Neon on the water, signal on the shore",
    "We drove until the static said our names",
    "Every streetlight counting down the night",
    "Hold the frequency, don't let it fade",
    "Chrome along the coastline, glowing slow",
    "Your voice comes in between the stations",
    "Turn it up until the windows hum",
    "A little weather in a pocket of the sky",
    "Rain on the radio, sun in the chorus",
    "We were louder than the thunder for a while",
    "Paper clouds and a borrowed afternoon",
    "Keep the tape running, keep the lights low",
]


def write_lrc(path: Path, track: Track, rng: random.Random) -> None:
    """Synced lyrics: one invented line every ~3 s, across the track's length."""
    # Each line once per song, in a shuffled order: drawn with replacement, the same
    # line came up twice in a row.
    pool = LYRIC_LINES[:]
    rng.shuffle(pool)
    lines = []
    t = 1.0
    while t < track.duration - 2 and pool:
        minutes, seconds = divmod(t, 60)
        lines.append(f"[{int(minutes):02d}:{seconds:05.2f}]{pool.pop()}")
        t += rng.uniform(2.6, 3.8)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def draw_portrait(name: str) -> Image.Image:
    """An artist picture: initials over a flat colour and two shapes, kept inside the round crop."""
    size = 500
    index = sum(ord(c) for c in name) % len(COVER_SETS)
    bg_hex, a_hex, b_hex, text_hex = COVER_SETS[(index + 5) % len(COVER_SETS)]
    bg, shape_a, shape_b, text = _rgb(bg_hex), _rgb(a_hex), _rgb(b_hex), _rgb(text_hex)
    img = Image.new("RGB", (size, size), bg)
    draw = ImageDraw.Draw(img)
    rng = random.Random(f"{SEED}:portrait:{name}")
    for colour in (shape_a, shape_b):
        s = rng.randint(130, 190)
        x0, y0 = rng.choice([(70, 70), (300, 80), (80, 300), (290, 290)])
        if rng.random() < 0.5:
            draw.ellipse([x0, y0, x0 + s, y0 + s], fill=colour, outline=INK, width=8)
        else:
            draw.rectangle([x0, y0, x0 + s, y0 + int(s * 0.6)], fill=colour, outline=INK, width=8)
    words = [w for w in re.split(r"\s+", name) if w and w[0].isalpha() and w.lower() not in {"the", "of", "feat."}]
    initials = "".join(w[0] for w in words[:2]).upper()
    font = _font(200)
    box = draw.textbbox((0, 0), initials, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(
        ((size - w) / 2 - box[0], (size - h) / 2 - box[1]),
        initials,
        font=font,
        fill=text,
        stroke_width=6 if text != INK else 0,
        stroke_fill=INK,
    )
    return img


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
            if album.title in LYRIC_ALBUMS:
                write_lrc(target.with_suffix(".lrc"), track, track_rng)
            total_tracks += 1

    artists = {a.artist for a in albums} | {t.artist.split(" feat.")[0] for a in albums for t in a.tracks if t.artist}
    # Pictures for the artist pages, beside the library (not inside it: the scanner
    # should not see them). seed.py uploads them through the real upload endpoint.
    portraits = out.parent / f"{out.name}-artists"
    if portraits.exists():
        shutil.rmtree(portraits)
    portraits.mkdir()
    named = artists | {
        t.artist.split(" feat. ")[1] for a in albums for t in a.tracks if t.artist and " feat. " in t.artist
    }
    for name in sorted(named - {"Various Artists"}):
        draw_portrait(name).save(portraits / f"{sanitize(name)}.jpg", "JPEG", quality=90)
    print(f"{len(albums)} albums, {total_tracks} tracks, {len(artists)} artists -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
