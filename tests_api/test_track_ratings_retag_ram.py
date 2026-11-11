"""Ratings in RAM after a retag (#777): read from the table, never carried.

A retag rebuilds the track object. Favourites and play counts are copied over
(`track_edit._DERIVED_STATE`), but a rating is not: when the new hash is one
another file already holds, the table keeps the target's rating ("existing wins")
and the copied map put a different rating into the same group. The store now
reads the rows back after the commit (`track_edit._refresh_ratings`); the
behaviour is pinned in `test_track_ratings_api.py`.
"""

from aivinnet.lib import track_edit


def test_ratings_are_not_part_of_the_copied_state():
    assert "rated_by" not in track_edit._DERIVED_STATE
