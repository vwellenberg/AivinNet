"""Tests for aivinnet.utils general utilities."""

from aivinnet.utils import flatten


class TestFlatten:
    def test_basic(self):
        assert flatten([[1, 2], [3, 4]]) == [1, 2, 3, 4]

    def test_empty(self):
        assert flatten([]) == []

    def test_single_list(self):
        assert flatten([[1, 2, 3]]) == [1, 2, 3]

    def test_empty_sublists(self):
        assert flatten([[], [], []]) == []

    def test_mixed_empty(self):
        assert flatten([[1], [], [2, 3]]) == [1, 2, 3]

    def test_strings(self):
        assert flatten([["a", "b"], ["c"]]) == ["a", "b", "c"]
