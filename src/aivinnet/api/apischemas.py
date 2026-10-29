"""
Reusable Pydantic basic schemas for the API
"""

from typing import Any

from pydantic import BaseModel, Field, model_validator

from aivinnet.settings import Defaults


class JsonBodyModel(BaseModel):
    """
    Base for JSON request bodies whose fields all have defaults.

    flask_openapi3 3.x read a request without a body as `{}`, so such an endpoint
    answered 200 with the defaults. 4.x passes `None` on, and pydantic rejects that
    with 422 before the handler runs. Mapping `None` back to `{}` restores 3.x.
    A model with required fields still answers 422 on an empty body, now with a
    field error rather than a type error.
    """

    @model_validator(mode="before")
    @classmethod
    def _missing_body_is_empty(cls, data: Any) -> Any:
        return {} if data is None else data


class AlbumHashSchema(BaseModel):
    """
    Extending this class will give you a model with the `albumhash` field
    """

    albumhash: str = Field(
        description="The album hash",
        json_schema_extra={
            "example": Defaults.API_ALBUMHASH,
        },
        min_length=Defaults.HASH_LENGTH,
        max_length=Defaults.HASH_LENGTH,
    )


class ArtistHashSchema(BaseModel):
    """
    Extending this class will give you a model with the `artisthash` field
    """

    artisthash: str = Field(
        description="The artist hash",
        json_schema_extra={
            "example": Defaults.API_ARTISTHASH,
        },
        min_length=Defaults.HASH_LENGTH,
        max_length=Defaults.HASH_LENGTH,
    )


class TrackHashSchema(BaseModel):
    """
    Extending this class will give you a model with the `trackhash` field
    """

    trackhash: str = Field(
        description="The track hash",
        json_schema_extra={
            "example": Defaults.API_TRACKHASH,
        },
        min_length=Defaults.HASH_LENGTH,
        max_length=Defaults.HASH_LENGTH,
    )


# INFO: The card limits size a page section (an artist's top tracks, similar
# albums). The client asks for a screenful; an unbounded value made one request
# serialise as much as the caller liked on the single request thread, and a
# negative one answered 500 instead of 422 (#295).
CARD_LIMIT_MAX = 500


class GenericLimitSchema(BaseModel):
    """
    Extending this class will give you a model with the `limit` field
    """

    # -1 is "all of them": a playlist's tracks, the favourites "play all"
    # (usePlayFrom.ts). Anything below that was never meant and went through
    # to a slice or SQL LIMIT unchecked (#295).
    limit: int = Field(
        description="The number of items to return; -1 for all",
        json_schema_extra={
            "example": Defaults.API_CARD_LIMIT,
        },
        default=Defaults.API_CARD_LIMIT,
        ge=-1,
    )


# INFO: The following 3 classes are duplicated to specify the type of items
class TrackLimitSchema(BaseModel):
    """
    Extending this class will give you a model with the `limit` field
    """

    limit: int = Field(
        description="The number of tracks to return",
        json_schema_extra={
            "example": Defaults.API_CARD_LIMIT,
        },
        default=5,
        alias="tracklimit",
        ge=0,
        le=CARD_LIMIT_MAX,
    )


class AlbumLimitSchema(BaseModel):
    """
    Extending this class will give you a model with the `limit` field
    """

    limit: int = Field(
        description="The number of albums to return",
        json_schema_extra={
            "example": Defaults.API_CARD_LIMIT,
        },
        default=Defaults.API_CARD_LIMIT,
        alias="albumlimit",
        ge=0,
        le=CARD_LIMIT_MAX,
    )


class ArtistLimitSchema(BaseModel):
    """
    Extending this class will give you a model with the `limit` field
    """

    limit: int = Field(
        description="The number of artists to return",
        json_schema_extra={
            "example": Defaults.API_CARD_LIMIT,
        },
        default=Defaults.API_CARD_LIMIT,
        alias="artistlimit",
        ge=0,
        le=CARD_LIMIT_MAX,
    )
