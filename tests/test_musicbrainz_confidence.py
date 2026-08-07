"""
Tests for the MusicBrainz confidence gate.

The gate exists because the lookup used to take the first search result no
matter how badly it matched, which handed sparsely tagged albums a confidently
WRONG cover. The rule these tests pin down is "no cover beats a wrong cover":
every case below asks whether a candidate would be accepted, and the expected
answer is "no" far more often than "yes".
"""

import logging

import pytest

from aivinnet.lib import musicbrainz as mb

MBID = "11111111-2222-3333-4444-555555555555"
OTHER_MBID = "99999999-8888-7777-6666-555555555555"


def make_group(
    title: str = "Abbey Road",
    artist: str = "The Beatles",
    score: int | str = 100,
    mbid: str = MBID,
    sort_name: str | None = None,
) -> dict:
    """A single release-group search result shaped like the MusicBrainz API's."""
    return {
        "id": mbid,
        "score": score,
        "title": title,
        "artist-credit": [
            {
                "name": artist,
                "artist": {
                    "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    "name": artist,
                    "sort-name": sort_name if sort_name is not None else artist,
                },
            }
        ],
    }


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


@pytest.fixture
def search(monkeypatch):
    """
    Drive _search_release_group_mbid against a canned result list.

    Returns a helper that takes the release groups the "API" should answer with
    and runs the search; `helper.calls` records the outgoing requests so a test
    can assert that no request was made at all.
    """
    # The real throttle sleeps up to 1.1s between calls to respect the
    # MusicBrainz rate limit. Irrelevant here and it would dominate the runtime.
    monkeypatch.setattr(mb, "_mb_throttle", lambda: None)

    class Helper:
        def __init__(self):
            self.calls: list[dict] = []
            self.groups: list[dict] = []
            self.status_code = 200

        def _get(self, url, params=None, headers=None, timeout=None, **kwargs):
            self.calls.append({"url": url, "params": params or {}})
            return FakeResponse({"release-groups": self.groups}, self.status_code)

        def run(self, groups: list[dict], album: str = "Abbey Road", artist: str = "The Beatles"):
            self.groups = groups
            return mb._search_release_group_mbid(album, artist)

    helper = Helper()
    monkeypatch.setattr(mb.requests, "get", helper._get)
    return helper


class TestNormaliseArtist:
    def test_case_and_spacing(self):
        assert mb._normalise_artist("  The   BEATLES ") == "the beatles"

    def test_folds_accents(self):
        assert mb._normalise_artist("Björk") == "bjork"
        assert mb._normalise_artist("Sigur Rós") == "sigur ros"

    def test_punctuation_becomes_separator(self):
        assert mb._normalise_artist("AC/DC") == "ac dc"
        assert mb._normalise_artist("Panic! At The Disco") == "panic at the disco"

    def test_ampersand_expands_to_and(self):
        assert mb._normalise_artist("Simon & Garfunkel") == mb._normalise_artist("Simon and Garfunkel")

    def test_strips_trailing_feature_credit(self):
        assert mb._normalise_artist("Santana feat. Rob Thomas") == "santana"
        assert mb._normalise_artist("Santana featuring Rob Thomas") == "santana"
        assert mb._normalise_artist("Santana ft Rob Thomas") == "santana"
        assert mb._normalise_artist("Santana w/ Rob Thomas") == "santana"

    def test_strips_bracketed_addition(self):
        assert mb._normalise_artist("Michael Jackson (feat. Paul McCartney)") == "michael jackson"

    def test_feature_marker_inside_a_word_is_not_a_marker(self):
        # A marker matched inside a real name would TRUNCATE it, and a truncated
        # name is a subset of the full one — i.e. a false accept, the exact
        # failure this gate exists to prevent.
        assert mb._normalise_artist("Fleet Feathers") == "fleet feathers"
        assert mb._normalise_artist("Wu-Tang Clan") == "wu tang clan"

    def test_keeps_non_latin_script(self):
        # Stripping to [a-z] would empty these out and reject every Japanese
        # game soundtrack in the library.
        assert mb._normalise_artist("坂本龍一") != ""

    def test_empty_input(self):
        assert mb._normalise_artist("") == ""
        assert mb._normalise_artist("!!!???") == ""


class TestArtistTokens:
    def test_drops_the(self):
        assert mb._artist_tokens("the beatles") == frozenset({"beatles"})

    def test_keeps_the_when_it_is_all_there_is(self):
        assert mb._artist_tokens("the the") == frozenset({"the"})


class TestIsUsableAlbumartist:
    @pytest.mark.parametrize("name", ["Radiohead", "Various Artists", "坂本龍一"])
    def test_real_names_are_usable(self, name):
        assert mb.is_usable_albumartist(name) is True

    @pytest.mark.parametrize("name", ["", "   ", "Unknown", "unknown", "UNKNOWN", "Unknown Artist"])
    def test_placeholders_are_not_usable(self, name):
        assert mb.is_usable_albumartist(name) is False

    def test_various_artists_is_deliberately_usable(self):
        # "Various Artists" states something true about the album (it is a
        # compilation) and MusicBrainz credits compilations to an artist of that
        # name, unlike "Unknown", which only says our tags are empty.
        assert mb.is_usable_albumartist("Various Artists") is True


class TestArtistMatches:
    def test_exact(self):
        assert mb._artist_matches("Radiohead", ["Radiohead"]) is True

    def test_ignores_leading_article(self):
        assert mb._artist_matches("The Beatles", ["Beatles"]) is True
        assert mb._artist_matches("Beatles", ["The Beatles"]) is True

    def test_matches_musicbrainz_sort_name(self):
        assert mb._artist_matches("The Beatles", ["Beatles, The"]) is True

    def test_local_names_only_the_lead(self):
        assert mb._artist_matches("Ludwig van Beethoven", ["Ludwig van Beethoven; Herbert von Karajan"]) is True

    def test_local_adds_a_guest(self):
        assert mb._artist_matches("Santana feat. Rob Thomas", ["Santana"]) is True

    def test_accent_and_case_differences(self):
        assert mb._artist_matches("bjork", ["Björk"]) is True

    def test_different_artist_rejected(self):
        assert mb._artist_matches("Radiohead", ["Coldplay"]) is False

    def test_partial_word_overlap_is_not_a_match(self):
        assert mb._artist_matches("The Beatles", ["The Beach Boys"]) is False

    def test_empty_local_artist_never_matches(self):
        assert mb._artist_matches("", ["Radiohead"]) is False

    def test_empty_candidates_never_match(self):
        assert mb._artist_matches("Radiohead", []) is False
        assert mb._artist_matches("Radiohead", ["", "   ", "!!!"]) is False


class TestArtistCreditNames:
    def test_offers_joined_credit_and_every_part(self):
        group = {
            "artist-credit": [
                {"name": "Jay-Z", "artist": {"name": "JAY-Z", "sort-name": "JAY-Z"}, "joinphrase": " & "},
                {"name": "Linkin Park", "artist": {"name": "Linkin Park", "sort-name": "Linkin Park"}},
            ]
        }
        names = mb._artist_credit_names(group)

        assert "Jay-Z & Linkin Park" in names
        assert "Linkin Park" in names
        # A tag naming only one half of the collaboration still matches.
        assert mb._artist_matches("Linkin Park", names) is True
        assert mb._artist_matches("Jay-Z & Linkin Park", names) is True

    def test_survives_malformed_payload(self):
        assert mb._artist_credit_names({}) == []
        assert mb._artist_credit_names({"artist-credit": None}) == []
        assert mb._artist_credit_names({"artist-credit": ["nonsense"]}) == []
        assert mb._artist_credit_names({"artist-credit": [{"artist": "nonsense"}]}) == []


class TestResultScore:
    def test_int(self):
        assert mb._result_score({"score": 92}) == 92

    def test_string(self):
        assert mb._result_score({"score": "92"}) == 92

    @pytest.mark.parametrize("group", [{}, {"score": None}, {"score": "high"}])
    def test_unscored_counts_as_zero(self, group):
        # 0 is below any floor, so an unscored result is rejected rather than
        # silently trusted.
        assert mb._result_score(group) == 0


class TestSearchGate:
    def test_clean_match_passes(self, search):
        assert search.run([make_group(score=100)]) == MBID

    def test_high_score_wrong_artist_is_rejected(self, search):
        # The dangerous case: MusicBrainz normalises scores against the best hit
        # of the query, so a completely wrong album still comes back as a 100.
        assert search.run([make_group(artist="The Beach Boys", score=100)]) is None

    def test_low_score_right_artist_is_rejected(self, search):
        assert search.run([make_group(artist="The Beatles", score=40)]) is None

    def test_score_exactly_at_the_floor_passes(self, search):
        assert search.run([make_group(score=mb.MIN_SEARCH_SCORE)]) == MBID

    def test_score_one_below_the_floor_is_rejected(self, search):
        assert search.run([make_group(score=mb.MIN_SEARCH_SCORE - 1)]) is None

    def test_walks_past_a_wrong_artist_to_a_good_hit(self, search):
        groups = [
            make_group(artist="The Beach Boys", score=100, mbid=OTHER_MBID),
            make_group(artist="The Beatles", score=90, mbid=MBID),
        ]
        assert search.run(groups) == MBID

    def test_does_not_settle_for_a_weak_leftover(self, search):
        groups = [
            make_group(artist="The Beach Boys", score=100, mbid=OTHER_MBID),
            make_group(artist="The Beatles", score=50, mbid=MBID),
        ]
        assert search.run(groups) is None

    def test_result_without_mbid_is_skipped(self, search):
        groups = [make_group(mbid="", score=100), make_group(score=100, mbid=MBID)]
        assert search.run(groups) == MBID

    def test_no_results(self, search):
        assert search.run([]) is None

    def test_rejection_is_logged_with_score_and_both_names(self, search, caplog):
        with caplog.at_level(logging.INFO, logger="aivinnet.lib.musicbrainz"):
            search.run([make_group(artist="The Beach Boys", score=97)])

        messages = [r.getMessage() for r in caplog.records]
        assert any("The Beach Boys" in m and "The Beatles" in m and "97" in m for m in messages), messages

    def test_below_floor_rejection_names_the_floor(self, search, caplog):
        with caplog.at_level(logging.INFO, logger="aivinnet.lib.musicbrainz"):
            search.run([make_group(score=12)])

        messages = [r.getMessage() for r in caplog.records]
        assert any("12" in m and str(mb.MIN_SEARCH_SCORE) in m for m in messages), messages


class TestFetchCoverForAlbum:
    def test_unknown_albumartist_never_reaches_the_network(self, search, caplog):
        # The "Unknown" decision: no cross-check is possible, so we do not fetch
        # a cover at all — and we do not even spend the rate-limited request.
        with caplog.at_level(logging.INFO, logger="aivinnet.lib.musicbrainz"):
            assert mb.fetch_cover_for_album("Greatest Hits", "Unknown") is None

        assert search.calls == []
        assert any("Unknown" in r.getMessage() for r in caplog.records)

    def test_empty_albumartist_never_reaches_the_network(self, search):
        assert mb.fetch_cover_for_album("Greatest Hits", "") is None
        assert search.calls == []

    def test_missing_albumartist_never_reaches_the_network(self, search):
        assert mb.fetch_cover_for_album("Greatest Hits", None) is None
        assert search.calls == []

    def test_named_albumartist_does_reach_the_network(self, search, monkeypatch):
        monkeypatch.setattr(mb, "_fetch_cover_bytes", lambda mbid: b"JPEGBYTES")
        search.groups = [make_group(score=100)]

        assert mb.fetch_cover_for_album("Abbey Road", "The Beatles") == b"JPEGBYTES"
        assert len(search.calls) == 1

    def test_rejected_match_yields_no_cover(self, search, monkeypatch):
        # The whole point: a wrong-artist hit must not produce cover bytes.
        monkeypatch.setattr(mb, "_fetch_cover_bytes", lambda mbid: b"WRONGCOVER")
        search.groups = [make_group(artist="The Beach Boys", score=100)]

        assert mb.fetch_cover_for_album("Abbey Road", "The Beatles") is None

    def test_simplified_title_retry_still_passes_the_gate(self, search, monkeypatch):
        monkeypatch.setattr(mb, "_fetch_cover_bytes", lambda mbid: b"JPEGBYTES")

        # First query (decorated title) finds a wrong-artist hit, the retry with
        # the decorations stripped finds the right one.
        responses = [
            [make_group(artist="The Beach Boys", score=100, mbid=OTHER_MBID)],
            [make_group(artist="The Beatles", score=100, mbid=MBID)],
        ]

        def _get(url, params=None, headers=None, timeout=None, **kwargs):
            search.calls.append({"url": url, "params": params or {}})
            return FakeResponse({"release-groups": responses[len(search.calls) - 1]})

        monkeypatch.setattr(mb.requests, "get", _get)

        assert mb.fetch_cover_for_album("Abbey Road (2019 Remaster)", "The Beatles") == b"JPEGBYTES"
        assert len(search.calls) == 2


class TestDiscPrefix:
    """
    Multi-disc rips carry "CD3: " in the album tag of every track, while
    MusicBrainz stores the work under its own title with the discs as media
    inside it. The verbatim search therefore finds nothing at all — measured:
    zero results for "CD3: The Red Shoes (Remastered)" by Kate Bush, and it was
    the only one of five sampled albums WITH a cover that the gate could not
    re-find.
    """

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("CD3: The Red Shoes (Remastered)", "The Red Shoes"),
            ("CD1 - Greatest Hits", "Greatest Hits"),
            ("Disc 2: Live in Berlin", "Live in Berlin"),
            ("disk 10 Encore", "Encore"),
        ],
    )
    def test_a_leading_disc_marker_is_stripped(self, raw, expected):
        assert mb.simplify_title(raw) == expected

    @pytest.mark.parametrize(
        "title",
        [
            # Not a disc marker: a real title that merely starts similarly.
            "CDs and Cassettes",
            "Discovery",
            "Disco 2000",
            # A number that is part of the name, not a disc index.
            "1999",
        ],
    )
    def test_it_does_not_eat_a_real_title(self, title):
        assert mb.simplify_title(title) == title


class TestTitleMatches:
    """
    The half of the gate that only the fuzzy sources need.

    MusicBrainz is searched by exact phrase, so it has already asserted the
    title; iTunes and Deezer take free text and answer with something for any
    query, so this is where "it is actually this album" gets decided.
    """

    @pytest.mark.parametrize(
        "ours,theirs",
        [
            ("Discovery", "Discovery"),
            # Folding: case, accents, punctuation, "&".
            ("discovery", "DISCOVERY"),
            ("Sigur Rós Live", "Sigur Ros Live"),
            ("Songs of Love & Hate", "Songs of Love and Hate"),
            ("Sgt. Pepper's", "Sgt Peppers"),
            # Decorations on either side.
            ("By The Way (2002)", "By The Way"),
            ("By The Way", "By The Way (Deluxe Edition)"),
            ("CD3: The Red Shoes", "The Red Shoes"),
        ],
    )
    def test_accepts_the_same_album_spelled_differently(self, ours, theirs):
        assert mb.title_matches(ours, theirs) is True

    @pytest.mark.parametrize(
        "ours,theirs",
        [
            # The subset trap. `_artist_matches` accepts a subset on purpose;
            # doing that here would hand "Greatest Hits" the cover of an
            # entirely different record.
            ("Greatest Hits", "Greatest Hits Vol. 2"),
            ("Greatest Hits Vol. 2", "Greatest Hits"),
            ("Live", "Live in Tokyo"),
            ("Discovery", "Discovery Two"),
            ("Discovery", "Homework"),
        ],
    )
    def test_rejects_a_merely_similar_title(self, ours, theirs):
        assert mb.title_matches(ours, theirs) is False

    def test_a_ligature_is_not_expanded(self):
        # A known limit, written down so it stays a decision rather than a
        # surprise: NFKD decomposes accents but not ligatures, so "æ" and "ae"
        # remain different characters. Expanding them would mean a second,
        # hand-kept table, and the cost of the miss is one album without a
        # cover — which is the outcome this whole gate prefers anyway.
        assert mb.title_matches("Agætis byrjun", "Agaetis byrjun") is False

    def test_a_title_that_folds_to_nothing_never_matches(self):
        # "(Untitled)" is all decoration: there is nothing left to compare, and
        # an empty string must not silently equal another empty string.
        assert mb.title_matches("(Untitled)", "(Untitled)") is False
        assert mb.title_matches("", "") is False


class TestAlbumMatches:
    """Both halves together — what a store candidate has to clear."""

    def test_accepts_when_title_and_artist_both_match(self):
        assert mb.album_matches("Discovery", "Daft Punk", "Discovery", ["Daft Punk"]) is True

    def test_rejects_the_right_title_by_the_wrong_artist(self):
        # The exact failure mode the gate exists for: "Discovery" is also an
        # album by several other acts.
        assert mb.album_matches("Discovery", "Daft Punk", "Discovery", ["Pink Floyd"]) is False

    def test_rejects_the_right_artist_with_the_wrong_album(self):
        assert mb.album_matches("Discovery", "Daft Punk", "Homework", ["Daft Punk"]) is False

    def test_accepts_a_guest_credit_on_the_store_side(self):
        # Artist folding still applies: "feat." is dropped before comparing.
        assert mb.album_matches("Smooth", "Santana", "Smooth", ["Santana feat. Rob Thomas"]) is True
