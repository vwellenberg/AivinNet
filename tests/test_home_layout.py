"""
The Home layout (`lib/home/layout.py`, #532): hidden rows and the order.

The module imports no database or store code, so these run in the fast lane.
"""

from aivinnet.lib.home.layout import COLLECTIONS, DEFAULT_ORDER, PINNED, make_layout, normalize_order

DEFAULT = ("continue_listening", "a", "b", "c", "d")


class TestOrder:
    def test_nothing_saved_is_the_default(self):
        assert normalize_order(None) == DEFAULT_ORDER
        assert normalize_order([]) == DEFAULT_ORDER

    def test_the_saved_order_wins(self):
        assert normalize_order(["d", "c", "b", "a"], DEFAULT) == ("continue_listening", "d", "c", "b", "a")

    def test_a_pinned_row_stays_on_top_whatever_was_saved(self):
        assert normalize_order(["b", "continue_listening", "a"], DEFAULT)[0] == "continue_listening"

    def test_keys_that_are_no_row_go_and_doubles_count_once(self):
        assert normalize_order(["b", "gone", "b", "a", "d", "c"], DEFAULT) == ("continue_listening", "b", "a", "d", "c")

    def test_a_row_added_since_goes_after_the_row_it_follows_by_default(self):
        # Saved before "c" existed: "c" follows "b" by default, so it lands after "b".
        assert normalize_order(["d", "b", "a"], DEFAULT) == ("continue_listening", "d", "b", "c", "a")

    def test_a_new_first_row_goes_to_the_top(self):
        # "a" follows no movable row by default: it opens the list.
        assert normalize_order(["c", "b", "d"], DEFAULT) == ("continue_listening", "a", "c", "b", "d")

    def test_every_row_is_named_exactly_once(self):
        order = normalize_order(["recently_added", COLLECTIONS, "x", "on_repeat", "on_repeat"])

        assert sorted(order) == sorted(DEFAULT_ORDER)
        assert order[: len(PINNED)] == PINNED


class TestLayout:
    def test_hidden_rows_are_left_out_of_what_home_builds(self):
        layout = make_layout(["b", "a"], ["a", "gone"], DEFAULT)

        assert layout.hidden == frozenset({"a"})
        assert layout.visible == ("continue_listening", "b", "c", "d")

    def test_a_pinned_row_can_be_hidden(self):
        assert "continue_listening" not in make_layout(None, ["continue_listening"], DEFAULT).visible

    def test_the_collections_are_a_row_of_their_own(self):
        assert COLLECTIONS in DEFAULT_ORDER
        assert COLLECTIONS not in make_layout(None, [COLLECTIONS]).visible
