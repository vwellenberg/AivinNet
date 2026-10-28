"""Outbound lookups must stay bounded inside a request.

The server handles one request at a time, so a lookup that sleeps, recurses or
loops with the caller's input stops playback for every listener. The lyrics
half of this file guarded Musixmatch's token retry (a `time.sleep(13)` that
called itself with no depth limit); that provider is gone, and LRCLIB's
outage handling is covered in `test_lyrics_lrclib.py` and
`test_outbound_off_request_thread.py`.
"""

import pytest


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
