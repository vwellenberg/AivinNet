"""The library check: which albums look broken after a scan.

Every case is one the reference library actually had (2026-10-02), and so is
every case the check must stay quiet about — a list that cries wolf on 85
folders of home recordings would be ignored, and then it finds nothing.
"""

from dataclasses import dataclass, field

from aivinnet.lib.library_audit import (
    NUMBER_ARTIST,
    PLACEHOLDER_ARTIST,
    PLACEHOLDER_TITLE,
    SPLIT,
    UNKNOWN_ARTIST,
    find_suspicious_albums,
)


@dataclass
class T:
    filepath: str
    title: str
    album: str
    albumhash: str
    artists: list = field(default_factory=list)
    albumartists: list = field(default_factory=list)

    @property
    def folder(self) -> str:
        return self.filepath.rsplit("/", 1)[0] + "/"


def people(*names):
    return [{"name": n} for n in names]


def track(folder, name, title, album, albumhash, artist, albumartist=None):
    return T(
        filepath=f"/m/{folder}/{name}",
        title=title,
        album=album,
        albumhash=albumhash,
        artists=people(artist),
        albumartists=people(albumartist or artist),
    )


class TestWhatItFinds:
    def test_saving_private_ryan_ten_albums_of_one_track(self):
        # No artist tags: the file name gave each track its number as the
        # artist, the folder gave them all one album title — ten albumhashes.
        tracks = [
            track(
                "Der Soldat James Ryan",
                f"{n:02} - Song {n}.mp3",
                f"Song {n}",
                "Der Soldat James Ryan",
                f"h{n}",
                f"{n:02}",
            )
            for n in range(1, 11)
        ]

        [finding] = find_suspicious_albums(tracks)

        assert finding.reasons == [SPLIT, NUMBER_ARTIST]
        assert finding.fragments == 10
        assert finding.trackcount == 10

    def test_a_soundtrack_split_by_composer(self):
        # Valheim: a real album tag, but each track's composer as its album
        # artist — so the album shows up once per composer.
        tracks = [
            track("Valheim", "01 - A.mp3", "A", "Valheim OST", "h1", "Freya Schack-Arnott"),
            track("Valheim", "02 - B.mp3", "B", "Valheim OST", "h2", "Patrik Jarlestam"),
        ]

        [finding] = find_suspicious_albums(tracks)

        assert finding.reasons == [SPLIT]
        assert finding.fragments == 2

    def test_placeholder_titles(self):
        tracks = [
            track("Weezer", f"Track {n:02}.MP3", f"Track {n:02}", "Neuer Titel (109)", "h", "Weezer") for n in (1, 2)
        ]

        [finding] = find_suspicious_albums(tracks)

        assert finding.reasons == [PLACEHOLDER_TITLE]

    def test_placeholder_artist(self):
        tracks = [track("U2", "01 - One.mp3", "One", "Achtung Baby", "h", "U2", "Neuer Künstler (4)")]

        [finding] = find_suspicious_albums(tracks)

        assert PLACEHOLDER_ARTIST in finding.reasons

    def test_a_ripped_album_without_any_artist(self):
        # Star Trek, The Best Of: 19 numbered files, no artist anywhere.
        tracks = [track("Star Trek", f"{n:02} Cue.mp3", f"Cue {n}", "Best Of", "h", "Unknown") for n in range(1, 8)]

        [finding] = find_suspicious_albums(tracks)

        assert finding.reasons == [UNKNOWN_ARTIST]


class TestWhatItLeavesAlone:
    def test_home_recordings_without_an_artist(self):
        # "Unknown" is the right artist for a JamMan loop or a phone memo.
        tracks = [
            track("Aufnahmen", f"LOOP{n:02}.wav", f"LOOP{n:02}", "Aufnahmen", "h", "Unknown") for n in range(1, 8)
        ]

        assert find_suspicious_albums(tracks) == []

    def test_a_folder_of_loose_singles(self):
        # No album tags: every file falls back to the folder's name as its
        # album, but that does not make "sort" one album split in four.
        tracks = [
            track("sort", "a.mp3", "A", "sort", "h1", "Sly Stone"),
            track("sort", "b.mp3", "B", "sort", "h2", "The Cold Bricks"),
        ]

        assert find_suspicious_albums(tracks) == []

    def test_a_clean_album(self):
        tracks = [track("Album", f"{n:02} - S.mp3", f"S{n}", "Album", "h", "Band") for n in range(1, 4)]

        assert find_suspicious_albums(tracks) == []

    def test_a_band_with_a_number_in_its_name(self):
        tracks = [track("50 Cent", "01 - In da Club.mp3", "In da Club", "Get Rich", "h", "50 Cent")]

        assert find_suspicious_albums(tracks) == []


class TestIgnoring:
    def test_an_ignored_finding_stays_off_the_list(self):
        tracks = [
            track("V", "01 - A.mp3", "A", "OST", "h1", "X"),
            track("V", "02 - B.mp3", "B", "OST", "h2", "Y"),
        ]
        [finding] = find_suspicious_albums(tracks)

        assert find_suspicious_albums(tracks, ignored=[finding.key]) == []

    def test_the_key_survives_a_tag_edit_that_changes_the_hash(self):
        # The albumhash changes on any edit; the key is folder + title, so
        # "ignore" is not undone by an unrelated fix in the same album.
        before = [track("V", "01 - A.mp3", "A", "OST", "h1", "X"), track("V", "02 - B.mp3", "B", "OST", "h2", "Y")]
        after = [track("V", "01 - A.mp3", "A", "OST", "h9", "X"), track("V", "02 - B.mp3", "B", "OST", "h2", "Y")]

        [finding] = find_suspicious_albums(before)

        assert find_suspicious_albums(after, ignored=[finding.key]) == []


class TestMergeCandidates:
    def test_the_artists_already_there_then_various(self):
        tracks = [
            track("V", "01 - A.mp3", "A", "OST", "h1", "Patrik"),
            track("V", "02 - B.mp3", "B", "OST", "h1", "Patrik"),
            track("V", "03 - C.mp3", "C", "OST", "h2", "Freya"),
        ]

        [finding] = find_suspicious_albums(tracks)

        assert finding.merge_candidates == ["Patrik", "Freya", "Various Artists"]

    def test_a_track_number_is_never_offered_as_the_artist(self):
        tracks = [track("R", f"{n:02} - S.mp3", f"S{n}", "R", f"h{n}", f"{n:02}") for n in (1, 2)]

        [finding] = find_suspicious_albums(tracks)

        assert finding.merge_candidates == ["Various Artists"]
