from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import GenericLimitSchema
from aivinnet.lib.home.get_recently_played import get_recently_played
from aivinnet.lib.home.recentlyadded import get_recently_added_items
from aivinnet.store.homepage import HomepageStore

bp_tag = Tag(name="Home", description="Homepage items")
api = APIBlueprint("home", __name__, url_prefix="/nothome", abp_tags=[bp_tag])


@api.get("/recents/added")
def get_recently_added(query: GenericLimitSchema):
    """
    Get recently added
    """
    return {"items": get_recently_added_items(query.limit)}


@api.get("/recents/played")
def get_recent_plays(query: GenericLimitSchema):
    """
    Get recently played
    """
    return {"items": get_recently_played(query.limit)}


class HomepageItem(BaseModel):
    limit: int = Field(default=9, description="The max number of items per group to return")


@api.get("/")
def homepage_items(query: HomepageItem):
    return HomepageStore.get_homepage_items(limit=query.limit)
