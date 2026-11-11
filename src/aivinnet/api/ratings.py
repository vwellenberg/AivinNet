import logging

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.db.userdata import TrackRatingTable
from aivinnet.settings import Defaults
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid

bp_tag = Tag(name="Ratings", description="Your personal track ratings, 1 to 5")
api = APIBlueprint("ratings", __name__, url_prefix="/ratings", abp_tags=[bp_tag])

# A handler crash reaches the journal as a single line without a traceback
# (.claude/rules/api-endpoints.md), so the failures below are logged with one.
log = logging.getLogger(__name__)

MIN_RATING = 1
MAX_RATING = 5


class RatingSetBody(BaseModel):
    trackhash: str = Field(
        description="The hash of the track",
        min_length=Defaults.HASH_LENGTH,
        max_length=Defaults.HASH_LENGTH,
    )
    rating: int = Field(
        description="The rating, from 1 to 5",
        ge=MIN_RATING,
        le=MAX_RATING,
    )


class RatingClearBody(BaseModel):
    trackhash: str = Field(
        description="The hash of the track",
        min_length=Defaults.HASH_LENGTH,
        max_length=Defaults.HASH_LENGTH,
    )


class RatingPath(BaseModel):
    trackhash: str = Field(..., description="The hash of the track")


@api.post("/set")
def set_rating(body: RatingSetBody):
    """
    Sets the current user's rating of a track, overwriting an earlier one.
    """
    # The track is checked BEFORE the write: an unknown hash is a 404 that
    # leaves the table as it was (.claude/rules/api-endpoints.md).
    group = TrackStore.trackhashmap.get(body.trackhash)
    if group is None:
        return {"msg": "Track not found"}, 404

    userid = get_current_userid()

    try:
        TrackRatingTable.set_rating(body.trackhash, userid, body.rating)
    except Exception:
        log.exception("Failed to rate track %s", body.trackhash)
        return {"msg": "Failed! An error occured"}, 500

    group.set_rating(userid, body.rating)

    return {"msg": "Rated", "rating": body.rating}


@api.post("/clear")
def clear_rating(body: RatingClearBody):
    """
    Removes the current user's rating of a track. Clearing an unrated track is a no-op.
    """
    userid = get_current_userid()

    try:
        TrackRatingTable.clear_rating(body.trackhash, userid)
    except Exception:
        log.exception("Failed to clear rating of track %s", body.trackhash)
        return {"msg": "Failed! An error occured"}, 500

    group = TrackStore.trackhashmap.get(body.trackhash)
    if group is not None:
        group.set_rating(userid, None)

    return {"msg": "Rating removed"}


@api.get("")
def get_all_ratings():
    """
    Every track the current user has rated, as `trackhash -> rating`.
    """
    return {"ratings": TrackRatingTable.of_user(get_current_userid())}


@api.get("/<trackhash>")
def get_rating(path: RatingPath):
    """
    The current user's rating of one track, or null when unrated.
    """
    return {"rating": TrackRatingTable.rating_of(path.trackhash, get_current_userid())}
