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
