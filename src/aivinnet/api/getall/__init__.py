from datetime import datetime

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field, model_validator

from aivinnet.api.apischemas import GenericLimitSchema
from aivinnet.lib.artwork import find_image
from aivinnet.models.album import Album
from aivinnet.models.artist import Artist
from aivinnet.serializers.album import serialize_for_card as serialize_album
from aivinnet.serializers.artist import serialize_for_card as serialize_artist
from aivinnet.settings import Paths
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.utils import format_number
from aivinnet.utils.dates import (
    create_new_date,
    date_string_to_time_passed,
    seconds_to_time_string,
    tag_year,
    timestamp_to_time_passed,
)

bp_tag = Tag(name="Get all", description="List all items")
api = APIBlueprint("getall", __name__, url_prefix="/getall", abp_tags=[bp_tag])

DEFAULT_SORT = "created_date"

# Sort keys the endpoint can actually serve, i.e. attributes that exist on the
# serialized item. Kept next to the handler so the docstring below and the
# validation cannot drift apart.
_SHARED_SORT_KEYS = frozenset({"duration", "created_date", "playcount", "playduration", "lastplayed", "trackcount"})
_ALBUM_ONLY_SORT_KEYS = frozenset({"title", "albumartists", "date"})
_ARTIST_ONLY_SORT_KEYS = frozenset({"name", "albumcount"})


def _valid_sort_keys(is_albums: bool) -> frozenset:
    extra = _ALBUM_ONLY_SORT_KEYS if is_albums else _ARTIST_ONLY_SORT_KEYS
    return _SHARED_SORT_KEYS | extra


# The most items `artwork=true` is answered for. Home's record crates ask for 16.
ARTWORK_LIMIT_MAX = 50


class GetAllItemsQuery(GenericLimitSchema):
    # Bounded: an unbounded limit serialised the whole library on the single
    # request thread. The largest real caller is the search browser's artist
    # list (searchBrowse.ts, 2000 per page).
    limit: int = Field(
        description="The number of items to return",
        default=GenericLimitSchema.model_fields["limit"].default,
        ge=1,
        le=2000,
    )
    start: int = Field(
        description="The start index of the items to return",
        example=0,
        default=0,
        ge=0,
    )
    sortby: str = Field(
        description="The key to sort items by",
        example="created_date",
        default="created_date",
    )

    reverse: str = Field(
        description="Reverse the sort",
        example=1,
        default="1",
    )

    artwork: bool = Field(
        description="Add `has_artwork` to every item: whether its medium image is real "
        f"artwork rather than the placeholder. Off by default, and only up to {ARTWORK_LIMIT_MAX} "
        "items, because an album without artwork costs a look into its folder",
        default=False,
    )

    @model_validator(mode="after")
    def _artwork_only_on_small_pages(self) -> "GetAllItemsQuery":
        # Every album without artwork lists its folder, on the one request
        # thread: 2000 of them on a NAS would stop the whole app.
        if self.artwork and self.limit > ARTWORK_LIMIT_MAX:
            raise ValueError(f"artwork is only answered for up to {ARTWORK_LIMIT_MAX} items")
        return self


class GetAllItemsPath(BaseModel):
    itemtype: str = Field(
        description="The type of items to return (albums | artists)",
        example="albums",
        default="albums",
    )


def _has_artwork(item: Album | Artist) -> bool:
    """Whether `/img/thumbnail/medium/<image>` (album) or `/img/artist/medium/<image>` is real artwork."""
    paths = Paths()
    if isinstance(item, Album):
        return find_image(paths.md_thumb_path, f"{item.albumhash}.webp", item.pathhash) is not None
    return find_image(paths.md_artist_img_path, f"{item.artisthash}.webp") is not None


@api.get("/<itemtype>")
def get_all_items(path: GetAllItemsPath, query: GetAllItemsQuery):
    """
    Get all items

    Used to show all albums or artists in the library

    Sort keys:
    -
    Both albums and artists: `duration`, `created_date`, `playcount`, `playduration`, `lastplayed`, `trackcount`

    Albums only: `title`, `albumartists`, `date`
    Artists only: `name`, `albumcount`
    """
    is_albums = path.itemtype == "albums"
    is_artists = path.itemtype == "artists"

    # Anything else left `items` unbound and answered 500.
    if not (is_albums or is_artists):
        return {"error": f"Unknown item type: {path.itemtype}"}, 404

    if is_albums:
        items = AlbumStore.get_flat_list()
    else:
        items = ArtistStore.get_flat_list()

    total = len(items)

    start = query.start
    limit = query.limit
    sort = query.sortby
    reverse = query.reverse == "1"

    sort_is_count = sort == "trackcount"
    sort_is_duration = sort == "duration"
    sort_is_create_date = sort == "created_date"
    sort_is_playcount = sort == "playcount"
    sort_is_playduration = sort == "playduration"
    sort_is_lastplayed = sort == "lastplayed"

    sort_is_date = is_albums and sort == "date"
    sort_is_artist = is_albums and sort == "albumartists"

    sort_is_artist_trackcount = is_artists and sort == "trackcount"
    sort_is_artist_albumcount = is_artists and sort == "albumcount"

    # An unknown sort key used to reach `getattr(x, sort)` and raise
    # AttributeError. The `except AttributeError` below then fell back to
    # `lambda_sort`, which raises the SAME AttributeError — uncaught, so the
    # endpoint answered 500 and the client rendered an empty library page.
    # Measured before this fix: `sortby=undefined` -> 500, `sortby=bogus` -> 500.
    #
    # A bad sort key is a client mistake, not a server failure: fall back to the
    # default ordering so the list still renders.
    if sort not in _valid_sort_keys(is_albums):
        sort = DEFAULT_SORT
        sort_is_create_date = True
        sort_is_count = sort_is_duration = sort_is_playcount = False
        sort_is_playduration = sort_is_lastplayed = False
        sort_is_date = sort_is_artist = False
        sort_is_artist_trackcount = sort_is_artist_albumcount = False

    lambda_sort = lambda x: getattr(x, sort)
    lambda_sort_casefold = lambda x: getattr(x, sort).casefold()

    if sort_is_artist:
        lambda_sort = lambda x: getattr(x, sort)[0]["name"].casefold()

    try:
        sorted_items = sorted(items, key=lambda_sort_casefold, reverse=reverse)
    except AttributeError:
        sorted_items = sorted(items, key=lambda_sort, reverse=reverse)

    items = sorted_items[start : start + limit]
    album_list = []

    for item in items:
        item_dict = serialize_album(item) if is_albums else serialize_artist(item)

        if query.artwork:
            # What the image server answers for the medium image the cards load
            # (`lib/artwork.find_image`, the decision it serves from). Home's
            # record crates ask for it instead of probing every cover with a
            # request of its own.
            item_dict["has_artwork"] = _has_artwork(item)

        if sort_is_date:
            # The release year in UTC, as stored; "" for none (#391).
            item_dict["help_text"] = tag_year(item.date) or ""

        if sort_is_create_date:
            date = create_new_date(datetime.fromtimestamp(item.created_date))
            timeago = date_string_to_time_passed(date)
            item_dict["help_text"] = timeago

        if sort_is_count:
            item_dict["help_text"] = f"{format_number(item.trackcount)} track{'' if item.trackcount == 1 else 's'}"

        if sort_is_duration:
            item_dict["help_text"] = seconds_to_time_string(item.duration)

        if sort_is_artist_trackcount:
            item_dict["help_text"] = f"{format_number(item.trackcount)} track{'' if item.trackcount == 1 else 's'}"

        if sort_is_artist_albumcount:
            item_dict["help_text"] = f"{format_number(item.albumcount)} album{'' if item.albumcount == 1 else 's'}"

        if sort_is_playcount:
            item_dict["help_text"] = f"{format_number(item.playcount)} play{'' if item.playcount == 1 else 's'}"

        if sort_is_lastplayed:
            if item.playduration == 0:
                item_dict["help_text"] = "Never played"
            else:
                item_dict["help_text"] = timestamp_to_time_passed(item.lastplayed)

        if sort_is_playduration:
            item_dict["help_text"] = seconds_to_time_string(item.playduration)

        album_list.append(item_dict)

    return {"items": album_list, "total": total}
