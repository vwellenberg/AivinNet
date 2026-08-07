"""Tests for aivinnet.utils.hashing."""

from aivinnet.utils.hashing import create_hash


class TestCreateHash:
    def test_deterministic(self):
        assert create_hash("hello") == create_hash("hello")

    def test_case_insensitive(self):
        assert create_hash("Juice WRLD") == create_hash("juice wrld")
        assert create_hash("ACDC") == create_hash("acdc")

    def test_ignores_spaces(self):
        assert create_hash("Juice WRLD") == create_hash("JuiceWRLD")

    def test_ignores_non_alnum(self):
        assert create_hash("AC/DC") == create_hash("ACDC")
        assert create_hash("Guns N' Roses") == create_hash("Guns N Roses")

    def test_multiple_args(self):
        h1 = create_hash("artist", "album")
        h2 = create_hash("artist", "album")
        assert h1 == h2

    def test_different_inputs_different_hashes(self):
        assert create_hash("Beatles") != create_hash("Queen")

    def test_empty_string(self):
        result = create_hash("")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_unicode_decode(self):
        h1 = create_hash("Björk", decode=True)
        h2 = create_hash("Bjork", decode=True)
        assert h1 == h2

    def test_returns_hex_string(self):
        result = create_hash("test")
        assert all(c in "0123456789abcdef" for c in result)
