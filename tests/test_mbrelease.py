"""Reading MusicBrainz' answer for a release.

Parsing is where a metadata feature fails quietly: a release whose discs are
numbered wrong, or whose track titles silently fall back to the recording's,
produces a plausible track list that gets written into files. So the shapes
MusicBrainz really sends — nested artist credits, media without a position,
tracks without a length — are pinned here rather than discovered in production.
"""

import pytest

from aivinnet.lib import mbrelease
from aivinnet.lib.mbrelease import fetch_release_tracks, search_releases


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Nothing in this file may reach musicbrainz.org."""
    monkeypatch.setattr(mbrelease, "_get", lambda url, params: pytest.fail(f"unstubbed request to {url}"))


def answer(monkeypatch, payload):
    seen = {}

    def _get(url, params):
        seen["url"] = url
        seen["params"] = params
        return payload

    monkeypatch.setattr(mbrelease, "_get", _get)
    return seen


class TestSearch:
    def test_it_asks_for_the_album_and_the_artist(self, monkeypatch):
        seen = answer(monkeypatch, {"releases": []})

        search_releases("Abbey Road", "The Beatles")

        assert seen["params"]["query"] == 'release:"Abbey Road" AND artist:"The Beatles"'

    def test_a_quote_in_the_title_cannot_break_the_query(self, monkeypatch):
        seen = answer(monkeypatch, {"releases": []})

        search_releases('Say "Hello"', "")

        assert seen["params"]["query"] == 'release:"Say \\"Hello\\""'

    def test_no_title_means_no_request(self, monkeypatch):
        # The autouse fixture fails on any request, so reaching the network here
        # is the failure.
        assert search_releases("   ", "Someone") == []

    def test_the_track_count_is_the_whole_release_not_one_disc(self, monkeypatch):
        # A double album reports two media of 12; a per-medium reading would
        # show "12 tracks" next to a 24-track album and look like the wrong
        # candidate.
        answer(
            monkeypatch,
            {
                "releases": [
                    {
                        "id": "rel-1",
                        "title": "The Album",
                        "score": 100,
                        "date": "1999",
                        "country": "DE",
                        "artist-credit": [{"name": "A"}, {"joinphrase": " & "}, {"name": "B"}],
                        "media": [
                            {"format": "CD", "track-count": 12},
                            {"format": "CD", "track-count": 12},
                        ],
                    }
                ]
            },
        )

        [candidate] = search_releases("The Album", "A")

        assert candidate.track_count == 24
        assert candidate.format == "2xCD"
        assert candidate.artist == "A & B"

    def test_a_release_without_an_id_is_dropped(self, monkeypatch):
        answer(monkeypatch, {"releases": [{"title": "No id"}, {"id": "rel-2", "title": "Fine"}]})

        assert [c.mbid for c in search_releases("x", "y")] == ["rel-2"]

    def test_a_failed_request_is_an_empty_list_not_a_crash(self, monkeypatch):
        answer(monkeypatch, None)

        assert search_releases("x", "y") == []


class TestTrackList:
    def test_it_asks_for_the_recordings(self, monkeypatch):
        # Without `inc=recordings` the lookup answers with media and no tracks
        # at all — an empty preview that looks like "this release is empty".
        seen = answer(monkeypatch, {"media": []})

        fetch_release_tracks("rel-1")

        assert "recordings" in seen["params"]["inc"]

    def test_discs_and_positions_come_through(self, monkeypatch):
        answer(
            monkeypatch,
            {
                "media": [
                    {
                        "position": 1,
                        "tracks": [
                            {"position": 1, "title": "One", "length": 180000},
                            {"position": 2, "title": "Two", "length": 240000},
                        ],
                    },
                    {"position": 2, "tracks": [{"position": 1, "title": "Three", "length": 60000}]},
                ]
            },
        )

        tracks = fetch_release_tracks("rel-1")

        assert [(t.disc, t.position, t.title) for t in tracks] == [
            (1, 1, "One"),
            (1, 2, "Two"),
            (2, 1, "Three"),
        ]

    def test_a_medium_without_a_position_still_numbers_in_order(self, monkeypatch):
        answer(
            monkeypatch,
            {"media": [{"tracks": [{"title": "A"}]}, {"tracks": [{"title": "B"}]}]},
        )

        assert [t.disc for t in fetch_release_tracks("rel-1")] == [1, 2]

    def test_the_track_title_wins_over_the_recording(self, monkeypatch):
        # A release may retitle a recording it reuses, and the track list is
        # what the sleeve says.
        answer(
            monkeypatch,
            {
                "media": [
                    {
                        "position": 1,
                        "tracks": [{"position": 1, "title": "Sleeve Title", "recording": {"title": "Canonical"}}],
                    }
                ]
            },
        )

        assert fetch_release_tracks("rel-1")[0].title == "Sleeve Title"

    def test_a_missing_length_is_zero_not_a_crash(self, monkeypatch):
        answer(monkeypatch, {"media": [{"position": 1, "tracks": [{"position": 1, "title": "A"}]}]})

        # 0 means "no evidence" to the matcher — deliberately not None, which
        # would need a branch at every comparison.
        assert fetch_release_tracks("rel-1")[0].length == 0

    def test_a_track_without_a_title_is_skipped(self, monkeypatch):
        answer(
            monkeypatch,
            {"media": [{"position": 1, "tracks": [{"position": 1}, {"position": 2, "title": "Real"}]}]},
        )

        assert [t.title for t in fetch_release_tracks("rel-1")] == ["Real"]

    def test_no_mbid_means_no_request(self):
        assert fetch_release_tracks("") == []
