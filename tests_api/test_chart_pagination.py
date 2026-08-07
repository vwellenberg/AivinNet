"""Request-cycle tests for chart pagination (offset/limit/total).

`ChartItemsQuery` gained `offset`, and all four /logger/top-* handlers window
their sorted list through `paginate_window`. The model mapping is exercised
against the real flask_openapi3 request cycle (the layer that has broken
invisibly twice before: AivinNet#36 -> #167/#39); the windowing math is
covered directly.
"""

import pytest


@pytest.fixture()
def chart_query_app():
    """
    A minimal flask_openapi3 app exposing the REAL chart query model.
    No auth hooks, no stores — the subject under test is the model mapping.
    """
    from flask_openapi3 import OpenAPI

    from swingmusic.api.scrobble import ChartItemsQuery

    app = OpenAPI(__name__)

    @app.get("/charts")
    def chart_stub(query: ChartItemsQuery):
        return {
            "duration": query.duration,
            "limit": query.limit,
            "offset": query.offset,
            "order_by": query.order_by,
        }

    app.config["TESTING"] = True
    return app.test_client()


def test_offset_defaults_to_zero(chart_query_app):
    res = chart_query_app.get("/charts")

    assert res.status_code == 200
    body = res.get_json()
    assert body["offset"] == 0
    assert body["limit"] == 10


def test_offset_is_parsed_from_the_query_string(chart_query_app):
    res = chart_query_app.get("/charts?offset=50&limit=50&duration=alltime")

    assert res.status_code == 200
    body = res.get_json()
    assert body["offset"] == 50
    assert body["limit"] == 50


def test_negative_offset_is_rejected(chart_query_app):
    res = chart_query_app.get("/charts?offset=-1")

    assert res.status_code == 422


def test_zero_limit_is_rejected(chart_query_app):
    res = chart_query_app.get("/charts?limit=0")

    assert res.status_code == 422


def test_paginate_window_slices_and_reports_total():
    from swingmusic.api.scrobble import paginate_window

    items = list(range(23))

    first_page, total = paginate_window(items, 0, 10)
    assert first_page == list(range(10))
    assert total == 23

    last_page, total = paginate_window(items, 20, 10)
    assert last_page == [20, 21, 22]
    assert total == 23

    beyond, total = paginate_window(items, 30, 10)
    assert beyond == []
    assert total == 23


# --- Leaderboard meter fields (extra.playduration + max_playduration) --------
#
# The client's charts screen draws a play-duration meter per row, scaled
# against the period's #1. Both fields are ADDITIVE payload: every chart item
# carries the raw numbers in `extra`, and every response root reports the
# pre-window maximum. The helpers are covered directly; the census below
# pins that all four endpoints actually attach them — the realistic failure
# mode is a fifth endpoint (or a refactor) dropping one of the four.


def test_chart_item_extra_carries_raw_numbers():
    from swingmusic.api.scrobble import chart_item_extra

    assert chart_item_extra(354, 64_764) == {"playcount": 354, "playduration": 64_764}


def test_chart_item_extra_merges_existing_extra_without_losing_it():
    from swingmusic.api.scrobble import chart_item_extra

    merged = chart_item_extra(12, 3_600, {"weakhash": "abc", "playduration": 1})
    assert merged["weakhash"] == "abc"
    # The chart's own numbers win over stale serializer leftovers.
    assert merged["playduration"] == 3_600
    assert merged["playcount"] == 12


def test_max_playduration_over_generator_and_empty_period():
    from swingmusic.api.scrobble import max_playduration

    assert max_playduration(d for d in [120, 64_764, 3_600]) == 64_764
    # Empty period (no scrobbles): 0 hides the meters instead of crashing.
    assert max_playduration(iter([])) == 0


def test_all_four_chart_endpoints_attach_the_meter_fields():
    """
    Census over the module source: each of the four /top-* response builders
    must attach `chart_item_extra(...)` per item and `max_playduration` on the
    response root. A source census (instead of four full request cycles) keeps
    this in the no-stores lane of this file — the field wiring is what broke
    conceptually, not the HTTP layer.
    """
    import inspect

    from swingmusic.api import scrobble

    source = inspect.getsource(scrobble)

    # 4 call sites + the definition itself.
    assert source.count("chart_item_extra(") == 5
    # 4 response roots + the definition + the docstring mention do not matter:
    # count only the response-key form.
    assert source.count('"max_playduration": max_playduration(') == 4
