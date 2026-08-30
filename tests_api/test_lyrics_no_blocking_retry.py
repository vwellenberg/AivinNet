"""The lyrics provider must not sleep or recurse inside a request.

The server handles one request at a time, so a `time.sleep` in a handler stops
playback for every listener. `_get_token` used to sleep 13 seconds on a 401 and
then call itself with no depth limit — and Musixmatch answers 401 exactly when
it is rate-limiting, so the condition that triggered the retry was the one that
kept triggering it.
"""

from types import SimpleNamespace

import pytest


@pytest.fixture()
def provider(monkeypatch, tmp_path):
    from aivinnet.plugins.lyrics import LyricsProvider

    monkeypatch.setattr(
        "aivinnet.plugins.lyrics.Paths",
        lambda: SimpleNamespace(lyrics_plugins_path=tmp_path),
    )

    return LyricsProvider()


def _rate_limited(_action, _query):
    """What Musixmatch sends while it is rate-limiting."""
    return SimpleNamespace(json=lambda: {"message": {"header": {"status_code": 401}}})


class TestRateLimited:
    def test_it_does_not_sleep(self, provider, monkeypatch):
        """THE guard. One sleep here freezes the whole app, playback included."""
        monkeypatch.setattr(provider, "_get", _rate_limited)
        monkeypatch.setattr(
            "aivinnet.plugins.lyrics.time.sleep",
            lambda _s: pytest.fail("slept inside a request handler"),
        )

        provider._get_token()

    def test_it_does_not_retry(self, provider, monkeypatch):
        """
        Retrying a rate limit immediately is the one thing guaranteed not to
        help, and the recursion had no depth limit.
        """
        calls = []

        def counting(action, query):
            calls.append(action)
            return _rate_limited(action, query)

        monkeypatch.setattr(provider, "_get", counting)
        monkeypatch.setattr("aivinnet.plugins.lyrics.time.sleep", lambda _s: None)

        provider._get_token()

        assert calls == ["token.get"], f"asked {len(calls)} times, expected one"

    def test_no_token_is_stored(self, provider, monkeypatch):
        # ⚠️ `sleep` is neutralised here even though this test is not about
        # sleeping. Without it, running this file against an unpatched tree does
        # not fail — it HANGS, sleeping 13 seconds per recursion for hours, which
        # is precisely what the server did. A regression test must not be able to
        # take the suite down with the bug it describes.
        monkeypatch.setattr("aivinnet.plugins.lyrics.time.sleep", lambda _s: None)
        monkeypatch.setattr(provider, "_get", _rate_limited)

        provider._get_token()

        assert provider.token is None


class TestCoverSearchQueryIsBounded:
    """
    On no hits the cover search retries with progressively shorter queries — one
    outbound round to iTunes AND Deezer per word dropped. The loop terminates on
    its own, so the number of blocking round-trips was decided purely by how
    many words the caller sent.
    """

    def test_a_very_long_query_is_refused(self):
        from pydantic import ValidationError

        from aivinnet.api.coverart import CoverSearchQuery

        with pytest.raises(ValidationError):
            CoverSearchQuery(q="word " * 300)

    def test_a_realistic_query_still_passes(self):
        from aivinnet.api.coverart import CoverSearchQuery

        assert CoverSearchQuery(q="Talking Heads - Remain in Light").q

    def test_the_fallback_chain_stays_short(self):
        """Belt and braces: even at the limit the number of rounds is small."""
        from aivinnet.lib.coverart import _fallback_queries

        at_the_limit = "a" * 199 + " b"

        assert len(_fallback_queries(at_the_limit)) <= 50
