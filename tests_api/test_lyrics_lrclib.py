"""The lyrics finder asks LRCLIB, and finds what is there.

Regression: the finder used Musixmatch's unofficial desktop API, and that API
stopped working without an error. `token.get` answers 200 with a user token of
56 zeros; with it, `track.subtitle.get` is a 404 for every track and
`track.lyrics.get` returns scrambled placeholder text. So the lyrics page said
"No lyrics found!" for everything, including "One Man's Fool" by Genesis,
which LRCLIB has in five synced versions.

Two more ways a song with lyrics came back empty, both fixed with it:

* A title with an edition suffix, or one cut off mid-bracket by a broken tag
  ("Stretch (My Friends B"), matches nothing. The search retries without it.
* Plain lyrics (no time tags) made the endpoint raise in
  `format_synced_lyrics`. They are a result too and come back unsynced.

The fixtures below are shaped like real LRCLIB answers (`/api/search`).
"""

import time
from types import SimpleNamespace

import pytest

SYNCED = "[00:12.34] Hello there\n[00:15.00] Second line"
PLAIN = "Hello there\nSecond line"


def _hit(id_, title, artist, album, synced=SYNCED, plain=PLAIN, instrumental=False):
    return {
        "id": id_,
        "name": title,
        "trackName": title,
        "artistName": artist,
        "albumName": album,
        "duration": 268.0,
        "instrumental": instrumental,
        "plainLyrics": plain,
        "syncedLyrics": synced,
    }


class _Response:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.ok = status < 400

    def json(self):
        return self._payload


@pytest.fixture()
def lyrics(monkeypatch):
    import aivinnet.plugins.lyrics as lyrics

    monkeypatch.setattr(lyrics, "_down_until", 0.0)
    return lyrics


@pytest.fixture()
def service(lyrics, monkeypatch):
    """LRCLIB, answering `/search` from a {(track_name, artist_name): hits} map."""
    answers: dict[tuple[str, str], list] = {}
    asked: list[tuple[str, dict | None]] = []

    def get(url, params=None, timeout=None):
        assert timeout, "every outbound call carries a timeout"
        action = url.removeprefix(lyrics.LyricsProvider.ROOT_URL)
        asked.append((action, params))
        if action == "search":
            return _Response(answers.get((params["track_name"], params["artist_name"]), []))
        return _Response({"code": 404, "name": "TrackNotFound"}, status=404)

    monkeypatch.setattr(lyrics.LyricsProvider.session, "get", get)
    return SimpleNamespace(answers=answers, asked=asked)


# ------------------------------------------------------------------ provider


class TestBareTitle:
    @pytest.mark.parametrize(
        ("title", "bare"),
        [
            ("Stretch (My Friends B", "Stretch"),  # cut off mid-bracket by the tag
            ("Hey Jude (Remastered 2015)", "Hey Jude"),
            ("Roxanne [Live]", "Roxanne"),
            ("Black - 2011 Remaster", "Black"),
            ("One Man's Fool", "One Man's Fool"),
            ("(I Can't Get No) Satisfaction", ""),  # all suffix: nothing to retry with
        ],
    )
    def test_strips_a_trailing_suffix(self, lyrics, title, bare):
        assert lyrics.bare_title(title) == bare


class TestPickBest:
    def _r(self, title, album, synced, artist="Band"):
        return {"track_id": title + album, "title": title, "artist": artist, "album": album, "synced": synced}

    def test_the_right_song_in_plain_beats_a_neighbour_with_times(self, lyrics):
        """The pick is saved as the track's .lrc for good: a wrong song costs more than no times."""
        right = self._r("Song", "Album", synced=False)
        neighbour = self._r("Song 2 (Reprise)", "Album", synced=True)

        assert lyrics.pick_best([neighbour, right], "Song", "Band", "Album") is right

    def test_synced_beats_the_right_album_in_plain(self, lyrics):
        plain_same_album = self._r("Song", "Album", synced=False)
        synced_other = self._r("Song", "Best Of", synced=True)

        assert lyrics.pick_best([plain_same_album, synced_other], "Song", "Band", "Album") is synced_other

    def test_the_right_album_wins_among_synced(self, lyrics):
        other = self._r("Song", "Best Of", synced=True)
        same = self._r("Song", "Album", synced=True)

        assert lyrics.pick_best([other, same], "Song", "Band", "Album") is same

    def test_a_cut_off_title_matches_through_its_bare_form(self, lyrics):
        bare = self._r("Stretch", "X", synced=False)
        other = self._r("Stretch You Out", "Y", synced=True)

        assert lyrics.pick_best([other, bare], "Stretch (My Friends B", "Band", "Z") is bare

    def test_another_artist_is_never_picked(self, lyrics):
        """'Black (Live)' by a small band, retried as 'Black', must not become Pearl Jam's."""
        pearl_jam = self._r("Black", "Ten", synced=True, artist="Pearl Jam")

        assert lyrics.pick_best([pearl_jam], "Black (Live)", "Small Band", "Live") is None

    @pytest.mark.parametrize(
        ("wanted", "found"),
        [
            ("Jan Valta and Adam Sporka", "Jan Valta"),
            ("Glenn Stafford, Derek Duke", "Derek Duke"),
            ("Red Hot Chili Peppers", "Red Hot Chili Peppers"),
            ("Bjork", "Björk"),
        ],
    )
    def test_the_same_act_under_another_spelling_passes(self, lyrics, wanted, found):
        track = self._r("Song", "A", synced=True, artist=found)

        assert lyrics.pick_best([track], "Song", wanted, "A") is track

    def test_the_service_ranking_decides_a_tie(self, lyrics):
        first = self._r("Song", "X", synced=True)
        second = self._r("Song", "Y", synced=True)

        assert lyrics.pick_best([first, second], "Song", "Band", "Album") is first

    def test_nothing_found_picks_nothing(self, lyrics):
        assert lyrics.pick_best([], "Song", "Band", "Album") is None
        assert lyrics.pick_best(None, "Song", "Band", "Album") is None


class TestSearch:
    def test_finds_a_song_by_title_and_artist(self, lyrics, service):
        service.answers[("One Man's Fool", "Genesis")] = [
            _hit(147, "One Man's Fool", "Genesis", "Calling All Stations"),
        ]

        found = lyrics.LyricsProvider().get_lrc("One Man's Fool", "Genesis")

        assert [(f["title"], f["synced"]) for f in found] == [("One Man's Fool", True)]

    def test_a_cut_off_title_is_retried_without_its_suffix(self, lyrics, service):
        service.answers[("Stretch", "Red Hot Chili Peppers")] = [
            _hit(9, "Stretch You Out", "Red Hot Chili Peppers", "One Hot Minute (Deluxe Edition)"),
        ]

        found = lyrics.LyricsProvider().get_lrc("Stretch (My Friends B", "Red Hot Chili Peppers")

        assert [f["title"] for f in found] == ["Stretch You Out"]
        assert [p["track_name"] for _, p in service.asked] == ["Stretch (My Friends B", "Stretch"]

    def test_a_whole_title_that_finds_something_is_not_shortened(self, lyrics, service):
        service.answers[("Hey Jude (Remastered 2015)", "The Beatles")] = [_hit(1, "Hey Jude", "The Beatles", "1")]

        lyrics.LyricsProvider().get_lrc("Hey Jude (Remastered 2015)", "The Beatles")

        assert len(service.asked) == 1

    def test_instrumentals_and_empty_entries_are_not_results(self, lyrics, service):
        service.answers[("Song", "Band")] = [
            _hit(1, "Song", "Band", "A", synced=None, plain=None, instrumental=True),
            _hit(2, "Song", "Band", "B", synced=None, plain=None),
            _hit(3, "Song", "Band", "C", synced=None),
        ]

        found = lyrics.LyricsProvider().get_lrc("Song", "Band")

        assert [(f["track_id"], f["synced"]) for f in found] == [("3", False)]

    def test_the_pick_is_downloaded_without_asking_again(self, lyrics, service):
        service.answers[("Song", "Band")] = [_hit(5, "Song", "Band", "A")]
        provider = lyrics.LyricsProvider()

        provider.get_lrc("Song", "Band")
        lrc = provider.get_lrc_by_id("5")

        assert lrc == SYNCED
        assert [a for a, _ in service.asked] == ["search"]

    def test_names_itself_instead_of_posing_as_a_browser(self, lyrics):
        agent = lyrics.LyricsProvider().session.headers["user-agent"]

        assert agent.startswith("AivinNet")


# ------------------------------------------------------------------ endpoint


TRACKHASH = "0853280a12c4f9e1"


class _Group:
    def __init__(self, tracks):
        self.tracks = tracks


@pytest.fixture()
def song(monkeypatch, tmp_path):
    from aivinnet.store.tracks import TrackStore

    path = tmp_path / "Red Hot Chili Peppers - Stretch (My Friends B-Side).mp3"
    path.write_bytes(b"x")
    track = SimpleNamespace(filepath=str(path), bitrate=320, trackhash=TRACKHASH)
    monkeypatch.setattr(TrackStore, "trackhashmap", {TRACKHASH: _Group([track])}, raising=False)
    return path


@pytest.fixture()
def api(api_client):
    from aivinnet.db.userdata import PluginTable

    client = api_client("aivinnet.api.plugins.lyrics")
    PluginTable.insert_one(
        {
            "name": "lyrics_finder",
            "active": True,
            "settings": {"auto_download": True, "overide_unsynced": False},
            "extra": {},
        }
    )
    return client


def _body(song, title="Stretch (My Friends B"):
    return {
        "trackhash": TRACKHASH,
        "title": title,
        "artist": "Red Hot Chili Peppers",
        "album": "B-Side-Tracks",
        "filepath": str(song),
    }


def test_synced_lyrics_come_back_timed_and_land_next_to_the_song(api, service, song):
    service.answers[("Stretch", "Red Hot Chili Peppers")] = [
        _hit(9, "Stretch You Out", "Red Hot Chili Peppers", "One Hot Minute (Deluxe Edition)"),
    ]

    res = api.post("/plugins/lyrics/search", json=_body(song))

    assert res.status_code == 200
    assert res.json["synced"] is True
    assert res.json["lyrics"][0] == {"time": 12340.0, "text": " Hello there"}
    assert song.with_suffix(".lrc").read_text() == SYNCED


def test_plain_lyrics_come_back_unsynced_instead_of_failing(api, service, song):
    service.answers[("Stretch", "Red Hot Chili Peppers")] = [
        _hit(9, "Stretch You Out", "Red Hot Chili Peppers", "One Hot Minute", synced=None),
    ]

    res = api.post("/plugins/lyrics/search", json=_body(song))

    assert res.status_code == 200
    assert res.json["synced"] is False
    assert res.json["lyrics"] == ["Hello there", "Second line"]


def test_plain_lyrics_never_replace_a_file_already_there(api, service, song):
    """'Override unsynced' asks for TIMED lyrics; the listener's own plain file stays."""
    own = song.with_suffix(".lrc")
    own.write_text("my own words")
    service.answers[("Stretch", "Red Hot Chili Peppers")] = [
        _hit(9, "Stretch", "Red Hot Chili Peppers", "One Hot Minute", synced=None),
    ]

    res = api.post("/plugins/lyrics/search", json=_body(song))

    assert res.json["synced"] is False
    assert own.read_text() == "my own words"


def test_synced_lyrics_do_replace_a_plain_file(api, service, song):
    own = song.with_suffix(".lrc")
    own.write_text("my own words")
    service.answers[("Stretch", "Red Hot Chili Peppers")] = [_hit(9, "Stretch", "Red Hot Chili Peppers", "X")]

    api.post("/plugins/lyrics/search", json=_body(song))

    assert own.read_text() == SYNCED


def test_nothing_found_is_an_empty_answer(api, service, song):
    res = api.post("/plugins/lyrics/search", json=_body(song, title="Unknown Song"))

    assert res.status_code == 200
    assert res.json["lyrics"] is None
    assert not song.with_suffix(".lrc").exists()


def test_an_outage_is_remembered_across_lookups(lyrics, monkeypatch):
    calls = []

    def busy(*_a, **_k):
        calls.append(1)
        return _Response({"message": "slow down"}, status=429)

    monkeypatch.setattr(lyrics.LyricsProvider.session, "get", busy)

    assert lyrics.LyricsProvider().get_lrc("Song", "Bänd") == []
    assert calls == [1], "the retries went out although the first call was refused"
    assert lyrics._down_until > time.monotonic()


class TestLrcTimestamps:
    """`[mm:ss.xx]` is hundredths of a second — read as milliseconds, ".34"
    was 34 ms, and every line of every synced file showed up to 0.9 s early."""

    @pytest.mark.parametrize(
        ("tag", "millis"),
        [("[00:12.34]", 12340.0), ("[00:12.3]", 12300.0), ("[00:12.345]", 12345.0), ("[01:02]", 62000.0)],
    )
    def test_the_fraction_is_a_fraction_of_a_second(self, tag, millis):
        from aivinnet.lib.lyrics import Lyrics

        assert Lyrics(f"{tag}line").format_synced_lyrics()[0]["time"] == millis

    def test_one_files_offset_does_not_shift_the_next(self):
        """`meta` was a class-level dict: an [offset:] stayed for every later file."""
        from aivinnet.lib.lyrics import Lyrics

        Lyrics("[offset:500]\n[00:01.00]shifted")

        assert Lyrics("[00:01.00]line").format_synced_lyrics()[0]["time"] == 1000.0
