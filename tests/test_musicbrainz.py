"""Tests for swingmusic.lib.musicbrainz."""

from swingmusic.lib.musicbrainz import _lucene_escape, _simplify_title


class TestLuceneEscape:
    def test_empty_string(self):
        assert _lucene_escape("") == ""

    def test_plain_text_unchanged(self):
        assert _lucene_escape("Abbey Road") == "Abbey Road"

    def test_unicode_unchanged(self):
        assert _lucene_escape("Björk - Homogenic") == "Björk - Homogenic"

    def test_escapes_double_quote(self):
        # 'Say "Hi"' must become 'Say \"Hi\"' (each " prefixed by a backslash)
        assert _lucene_escape('Say "Hi"') == 'Say \\"Hi\\"'

    def test_escapes_backslash(self):
        # 'C:\\path' (one literal backslash) -> 'C:\\\\path' (two backslashes)
        assert _lucene_escape("C:\\path") == "C:\\\\path"

    def test_backslash_escaped_before_quote(self):
        # Critical ordering test: a literal `\"` (backslash + quote) must
        # become `\\\"` (escaped backslash + escaped quote), NOT `\\\\"`
        # (which would happen if we naively escaped quotes first and then
        # re-escaped the backslash we just inserted).
        assert _lucene_escape('\\"') == '\\\\\\"'

    def test_multiple_quotes(self):
        assert _lucene_escape('"a""b"') == '\\"a\\"\\"b\\"'

    def test_lone_backslash(self):
        assert _lucene_escape("\\") == "\\\\"

    def test_mixed_content(self):
        # Realistic problem case: album title with quotes
        result = _lucene_escape('Greatest "Hits" Vol. 1')
        assert result == 'Greatest \\"Hits\\" Vol. 1'

    def test_no_double_escaping(self):
        # Idempotency-ish check: escaping should not silently swallow input.
        # Length must grow by exactly the number of special chars.
        s = 'a"b\\c"d'
        escaped = _lucene_escape(s)
        # 2 quotes + 1 backslash = 3 added backslashes
        assert len(escaped) == len(s) + 3


class TestSimplifyTitle:
    def test_plain_unchanged(self):
        assert _simplify_title("By The Way") == "By The Way"

    def test_strips_year_suffix(self):
        assert _simplify_title("By The Way (2002)") == "By The Way"

    def test_strips_soundtrack_suffix(self):
        assert (
            _simplify_title("Music of Towns (Kingdom Come: Deliverance Original Soundtrack)")
            == "Music of Towns"
        )

    def test_strips_brackets(self):
        assert _simplify_title("Album [Remastered]") == "Album"

    def test_collapses_inner_decoration(self):
        # Decoration in the middle is removed and whitespace collapsed.
        assert _simplify_title("Greatest (Deluxe) Hits") == "Greatest Hits"

    def test_strips_trailing_punctuation(self):
        assert _simplify_title("Title - (Bonus)") == "Title"

    def test_only_decoration_becomes_empty(self):
        assert _simplify_title("(Untitled)") == ""
