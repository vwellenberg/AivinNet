import random

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import GenericLimitSchema
from aivinnet.db.userdata import UserTable
from aivinnet.lib.home.get_recently_played import get_recently_played
from aivinnet.lib.home.layout import PINNED, Layout
from aivinnet.lib.home.recentlyadded import get_recently_added_items
from aivinnet.store.albums import AlbumStore
from aivinnet.store.homepage import HomepageStore
from aivinnet.utils.auth import get_current_userid

bp_tag = Tag(name="Home", description="Homepage items")
api = APIBlueprint("home", __name__, url_prefix="/nothome", abp_tags=[bp_tag])


class RecentsQuery(GenericLimitSchema):
    # Not "all": these lists are as long as the library or the history.
    limit: int = Field(
        description="The number of items to return",
        default=GenericLimitSchema.model_fields["limit"].default,
        ge=1,
        le=500,
    )


@api.get("/recents/added")
def get_recently_added(query: RecentsQuery):
    """
    Get recently added
    """
    return {"items": get_recently_added_items(query.limit)}


@api.get("/recents/played")
def get_recent_plays(query: RecentsQuery):
    """
    Get recently played
    """
    return {"items": get_recently_played(query.limit)}


class HomepageItem(BaseModel):
    limit: int = Field(default=9, description="The max number of items per group to return")


@api.get("/")
def homepage_items(query: HomepageItem):
    return HomepageStore.get_homepage_items(limit=query.limit)


def _layout_rows(layout: Layout) -> dict:
    names = HomepageStore.row_names()
    return {
        "rows": [
            {
                "key": key,
                "title": names[key][0],
                "description": names[key][1],
                "visible": key not in layout.hidden,
                # Hidden or shown, but not moved: always on top (layout.PINNED).
                "pinned": key in PINNED,
            }
            for key in layout.order
        ]
    }


@api.get("/layout")
def get_home_layout():
    """
    The user's Home rows in their order, and which of them are shown (#532).
    """
    return _layout_rows(HomepageStore.get_layout(get_current_userid()))


class HomeLayoutBody(BaseModel):
    # Bounded: what is stored is the normalized layout, but the request is
    # parsed before that.
    order: list[str] = Field(default_factory=list, max_length=100, description="Row keys in display order")
    hidden: list[str] = Field(default_factory=list, max_length=100, description="Row keys Home leaves out")


@api.put("/layout")
def set_home_layout(body: HomeLayoutBody):
    """
    Store the user's Home layout. Keys that are no row are dropped, rows the
    order leaves out keep their default place; an empty body is the default.
    Answers with the layout as stored.
    """
    userid = get_current_userid()
    # One guest account is shared by every guest: a layout saved there would
    # be every guest's Home. The other per-account writes refuse it too.
    user = UserTable.get_by_id(userid)
    if user is None or "guest" in user.roles:
        return {"msg": "The guest account has the default Home"}, 403

    layout = HomepageStore.set_layout(userid, body.order, body.hidden)
    return _layout_rows(layout)


@api.get("/surprise")
def surprise_album():
    """
    A random album from the library ("Surprise me").

    RAM only (AlbumStore). An empty library answers 200 with
    `{"albumhash": null}` rather than 404: nothing went wrong, there is just
    nothing to pick, and the client can treat both cases with one code path.
    """
    albumhashes = list(AlbumStore.albummap)

    return {"albumhash": random.choice(albumhashes) if albumhashes else None}
