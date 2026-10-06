import random

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import GenericLimitSchema
from aivinnet.lib.home.get_recently_played import get_recently_played
from aivinnet.lib.home.recentlyadded import get_recently_added_items
from aivinnet.store.albums import AlbumStore
from aivinnet.store.homepage import HomepageStore

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
