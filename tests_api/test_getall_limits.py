"""GET /getall/<itemtype> must not serialise the whole library on request."""

import pytest
from pydantic import ValidationError

from aivinnet.api.getall import GetAllItemsQuery


@pytest.mark.parametrize("params", [{"limit": 1_000_000}, {"limit": 0}, {"limit": -1}, {"start": -5}])
def test_out_of_range_paging_is_rejected(params):
    with pytest.raises(ValidationError):
        GetAllItemsQuery(**params)


def test_the_page_sizes_the_client_sends_still_pass():
    """itemlist.ts pages by 50, searchBrowse.ts by 2000."""
    assert GetAllItemsQuery(limit=50).limit == 50
    assert GetAllItemsQuery(limit=2000, start=4000).start == 4000
    assert GetAllItemsQuery().limit >= 1
