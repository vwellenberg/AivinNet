import random
from typing import Literal

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import GenericLimitSchema
from aivinnet.db.userdata import NotInterestedTable, UserTable
from aivinnet.lib.home.get_recently_played import get_recently_played
from aivinnet.lib.home.layout import PINNED, Layout
from aivinnet.lib.home.recentlyadded import get_recently_added_items
from aivinnet.settings import Defaults
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
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
    if _is_guest(userid):
        return {"msg": "The guest account has the default Home"}, 403

    layout = HomepageStore.set_layout(userid, body.order, body.hidden)
    return _layout_rows(layout)


def _is_guest(userid: int) -> bool:
    # One guest account is shared by every guest: what it saves would be every
    # guest's Home. The other per-account writes refuse it too.
    user = UserTable.get_by_id(userid)
    return user is None or "guest" in user.roles


def _not_interested_item(type: str, hash: str, timestamp: int) -> dict:
    """A mark as Settings lists it; `title` is None once the item left the library."""
    item = {"type": type, "hash": hash, "timestamp": timestamp, "title": None, "subtitle": None, "image": None}

    if type == "album":
        album = AlbumStore.get_album_by_hash(hash)
        if album is not None:
            item.update(
                title=album.title,
                subtitle=", ".join(a["name"] for a in album.albumartists),
                image=album.image,
            )
    else:
        artist = ArtistStore.get_artist_by_hash(hash)
        if artist is not None:
            item.update(title=artist.name, image=artist.image)

    return item


@api.get("/not-interested")
def get_not_interested():
    """
    What the user said "Not interested" to on Home (#531), newest first:
    albums from "Never played", artists from "Artists you might like".
    """
    marks = NotInterestedTable.of_user(get_current_userid())
    return {"items": [_not_interested_item(*mark) for mark in marks]}


class NotInterestedBody(BaseModel):
    type: Literal["album", "artist"] = Field(description="What the hash names")
    hash: str = Field(
        description="The album or artist hash",
        min_length=Defaults.HASH_LENGTH,
        max_length=Defaults.HASH_LENGTH,
    )


@api.post("/not-interested")
def add_not_interested(body: NotInterestedBody):
    """
    Leave an album out of "Never played", or an artist out of "Artists you
    might like", for this user (#531). Home leaves it out at once; marking it
    again is a no-op.
    """
    userid = get_current_userid()
    if _is_guest(userid):
        return {"msg": "The guest account has the default Home"}, 403

    store = AlbumStore.get_album_by_hash if body.type == "album" else ArtistStore.get_artist_by_hash
    if store(body.hash) is None:
        return {"msg": f"No such {body.type}"}, 404

    NotInterestedTable.add(userid, body.type, body.hash)
    return {"msg": "Marked"}


@api.delete("/not-interested")
def remove_not_interested(body: NotInterestedBody):
    """
    Take a "Not interested" back (#531). The card is back on the next Home if
    the row still holds it, and otherwise may come back with the row's next
    draw. Taking back an item that was never marked is a no-op. No store
    check: an album or artist that left the library can still be taken off
    the list.
    """
    userid = get_current_userid()
    if _is_guest(userid):
        return {"msg": "The guest account has the default Home"}, 403

    NotInterestedTable.remove(userid, body.type, body.hash)
    return {"msg": "Removed"}


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
