"""
Search against a library with nothing in it answers "no results", not a 500.

Observed on 2026-09-23: a test instance whose track table was empty answered
every `GET /search/top?q=the%20guild%202` with HTTP 500 until a scan had indexed
something. A fresh install hits the same wall, and so does any query that
matches nothing at all: `TopResults.search` took `all_results[0]` as the top
result without checking that the fuzzy search had found anything.

The `api_client` stores are empty by design, which is exactly the state under
test here — a fresh install before its first scan.
"""

import pytest


@pytest.fixture()
def search_api(api_client):
    return api_client("aivinnet.api.search")


def test_top_results_on_an_empty_library_are_empty(search_api):
    res = search_api.get("/search/top?q=the%20guild%202&limit=1")

    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.get_json() == {"top_result": None, "tracks": [], "artists": [], "albums": []}


@pytest.mark.parametrize("itemtype", ["tracks", "albums", "artists", "folders"])
def test_search_by_type_on_an_empty_library_is_empty(search_api, itemtype):
    # `tracks` and `albums` run through the same TopResults.search as /top and
    # died on the same missing top result; the other two are here so the whole
    # endpoint is pinned, not just the half that happened to break.
    res = search_api.get(f"/search/?itemtype={itemtype}&q=the%20guild%202&start=0&limit=30")

    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.get_json() == {"results": [], "more": False}
