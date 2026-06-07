"""Tests for the MusicBrainz negative (failed-cover) cache."""

import swingmusic.lib.musicbrainz as mb


class TestFailedCache:
    def setup_method(self):
        # Reset the in-memory cache before each test.
        mb._failed_cache = None

    def teardown_method(self):
        mb._failed_cache = None

    def _redirect_to_tmp(self, monkeypatch, tmp_path):
        target = tmp_path / "mb_failed_covers.json"
        monkeypatch.setattr(mb, "_failed_cache_file", lambda: target)
        return target

    def test_empty_by_default(self, monkeypatch, tmp_path):
        self._redirect_to_tmp(monkeypatch, tmp_path)
        assert mb.load_failed() == set()
        assert mb.is_failed("abc") is False

    def test_mark_then_is_failed(self, monkeypatch, tmp_path):
        self._redirect_to_tmp(monkeypatch, tmp_path)
        mb.mark_failed("abc123")
        assert mb.is_failed("abc123") is True
        assert mb.is_failed("other") is False

    def test_mark_is_persisted(self, monkeypatch, tmp_path):
        target = self._redirect_to_tmp(monkeypatch, tmp_path)
        mb.mark_failed("hash1")
        mb.mark_failed("hash2")
        assert target.exists()
        # Simulate a restart: drop the in-memory cache and reload from disk.
        mb._failed_cache = None
        reloaded = mb.load_failed()
        assert reloaded == {"hash1", "hash2"}

    def test_mark_is_idempotent(self, monkeypatch, tmp_path):
        self._redirect_to_tmp(monkeypatch, tmp_path)
        mb.mark_failed("dup")
        mb.mark_failed("dup")
        assert mb.load_failed() == {"dup"}

    def test_clear_failed(self, monkeypatch, tmp_path):
        self._redirect_to_tmp(monkeypatch, tmp_path)
        mb.mark_failed("a")
        mb.mark_failed("b")
        mb.clear_failed()
        assert mb.load_failed() == set()
        # And the cleared state persists across a reload.
        mb._failed_cache = None
        assert mb.load_failed() == set()

    def test_load_failed_returns_copy(self, monkeypatch, tmp_path):
        self._redirect_to_tmp(monkeypatch, tmp_path)
        mb.mark_failed("x")
        snap = mb.load_failed()
        snap.add("y")  # mutating the returned set must not affect the cache
        assert mb.is_failed("y") is False
