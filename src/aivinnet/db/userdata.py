import datetime
import time
from collections.abc import Iterable
from typing import Any, Literal

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    and_,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.orm import Mapped, mapped_column

from aivinnet.db import Base
from aivinnet.db.engine import DbEngine
from aivinnet.db.utils import (
    favorite_to_dataclass,
    favorites_to_dataclass,
    playlist_to_dataclass,
    plugin_to_dataclass,
    similar_artist_to_dataclass,
    tracklog_to_dataclass,
    user_to_dataclass,
)
from aivinnet.lib.playlist_maintenance import (
    TrackhashNotInPlaylist,
    merge_trackhashes,
    move_trackhash,
    prune_added_at,
    record_added_at,
    remove_trackhashes,
)
from aivinnet.utils.auth import get_current_userid, hash_password


class UserTable(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    image: Mapped[str] = mapped_column(String(), nullable=True)
    password: Mapped[str] = mapped_column(String())
    username: Mapped[str] = mapped_column(String(), index=True)
    roles: Mapped[list[str]] = mapped_column(JSON(), default_factory=lambda: [])
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True, default_factory=dict)

    # Bumped to invalidate every token minted before it. See
    # migrations/user_token_version.py for why the column is added from
    # setup_sqlite rather than from run_migrations.
    token_version: Mapped[int] = mapped_column(Integer(), default=0, server_default="0")

    @classmethod
    def get_all(cls):
        result = cls.execute(select(cls))

        for i in next(result).scalars():
            yield user_to_dataclass(i)

    @classmethod
    def insert_default_user(cls, password: str):
        # INFO: Runs once, on the very first start (setup_sqlite only calls this
        # when no user exists). The plaintext password is passed IN rather than
        # resolved here: `setup_sqlite` is the only caller that knows whether it
        # was generated, and it is the one that has to show it to the operator.
        user = {
            "username": "admin",
            "password": hash_password(password),
            "roles": ["admin"],
        }

        return cls.insert_one(user)

    @classmethod
    def insert_guest_user(cls):
        user = {
            "username": "guest",
            "password": hash_password("guest"),
            "roles": ["guest"],
        }

        return cls.insert_one(user)

    @classmethod
    def get_by_id(cls, id: int):
        result = cls.execute(select(cls).where(cls.id == id))
        res = next(result).scalar()

        if res:
            return user_to_dataclass(res)

    @classmethod
    def get_by_username(cls, username: str):
        res = cls.execute(select(cls).where(cls.username == username))
        res = next(res).scalar()

        if res:
            return user_to_dataclass(res)

    @classmethod
    def update_one(cls, user: dict[str, Any]):
        return next(cls.execute(update(cls).where(cls.id == user["id"]).values(user), commit=True))

    @classmethod
    def bump_token_version(cls, userid: int):
        """
        End every session this account has open.

        Incremented in SQL rather than read-then-written, so two requests
        revoking at the same time cannot land on the same number and leave one
        of the two sets of tokens alive.
        """
        return next(
            cls.execute(
                update(cls).where(cls.id == userid).values(token_version=cls.token_version + 1),
                commit=True,
            )
        )

    @classmethod
    def remove_by_username(cls, username: str):
        return next(cls.execute(delete(cls).where(cls.username == username), commit=True))


class PluginTable(Base):
    __tablename__ = "plugin"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(), unique=True)
    active: Mapped[bool] = mapped_column(Boolean())
    settings: Mapped[dict[str, Any]] = mapped_column(JSON())
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True)

    @classmethod
    def get_all(cls):
        result = cls.execute(select(cls))

        for i in next(result).scalars():
            yield plugin_to_dataclass(i)

    @classmethod
    def activate(cls, name: str, value: bool):
        return next(cls.execute(update(cls).where(cls.name == name).values(active=value), commit=True))

    @classmethod
    def get_by_name(cls, name: str):
        result = cls.execute(select(cls).where(cls.name == name))
        res = next(result).scalar()

        if res:
            return plugin_to_dataclass(res)

    @classmethod
    def update_settings(cls, name: str, settings: dict[str, Any]):
        return next(
            cls.execute(
                update(cls).where(cls.name == name).values(settings=settings),
                commit=True,
            )
        )


class SimilarArtistTable(Base):
    __tablename__ = "notlastfm_similar_artists"

    id: Mapped[int] = mapped_column(Integer(), primary_key=True)
    artisthash: Mapped[str] = mapped_column(String(), index=True)
    similar_artists: Mapped[dict[str, str]] = mapped_column(JSON())

    @classmethod
    def get_all(cls):
        result = cls.execute(select(cls).execution_options(yield_per=100))

        for i in next(result).scalars():
            yield similar_artist_to_dataclass(i)

    @classmethod
    def exists(cls, artisthash: str):
        """
        Check whether an artisthash exists in the database.
        """

        with DbEngine.manager() as conn:
            result = conn.execute(
                select(cls.artisthash).where(cls.artisthash == artisthash).execution_options(yield_per=100)
            )

            return len(result.scalars().all()) > 0

    @classmethod
    def get_by_hash(cls, artisthash: str):
        """
        Get a single artist by hash.
        """
        result = cls.execute(select(cls).where(cls.artisthash == artisthash))
        res = next(result).scalar()

        if res:
            return similar_artist_to_dataclass(res)


class FavoritesTable(Base):
    __tablename__ = "favorite"

    # A favorite belongs to exactly ONE user, so the same item may legitimately
    # be favorited by several users. `hash` used to carry a GLOBAL `unique=True`,
    # which turned the second user's insert into an IntegrityError -> HTTP 500
    # (AivinNet-Client#435). The uniqueness that was actually meant is "one row
    # per item PER USER".
    #
    # `create_all` never alters an existing table, so databases created before
    # this change are rebuilt on startup by
    # `migrations/favorites_unique_per_user.py`.
    __table_args__ = (UniqueConstraint("hash", "userid", name="uq_favorite_hash_userid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # No `index=True`: the unique constraint above already creates an index
    # whose leftmost column is `hash`, which serves the hash lookups below.
    hash: Mapped[str] = mapped_column(String())
    type: Mapped[str] = mapped_column(String(), index=True)
    timestamp: Mapped[int] = mapped_column(Integer(), index=True)
    userid: Mapped[int] = mapped_column(Integer(), ForeignKey("user.id", ondelete="cascade"), default=1, index=True)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True, default_factory=dict)

    @classmethod
    def get_all(cls, with_user: bool):
        """
        Every favorite of the current user (`with_user=True`), or of EVERY user
        (`with_user=False`).

        ⚠️ `with_user` has no default on purpose. It used to default to False —
        the opposite of every other user-scoped table here (`PlaylistTable`
        defaults its `current_user` to True, `ScrobbleTable` and
        `CollectionTable` filter unconditionally) — so a caller who simply did
        not think about it silently read everyone's rows. That is exactly what
        happened in the backup path (AivinNet-Client#513): the backup wrote
        foreign users' favorites into the file and the restore compared against
        them, so one user's favorite made another user's unrestorable.

        Requiring the argument turns "did not think about it" into a
        TypeError at the call site instead of wrong rows at runtime. There is
        one legitimate `False`: `lib/mapstuff.py::map_favorites` builds the
        in-memory stores for all users at startup, where there is no current
        user to ask for.
        """
        with DbEngine.manager() as conn:
            if with_user:
                result = conn.execute(select(cls).where(cls.userid == get_current_userid()))
            else:
                result = conn.execute(select(cls))

            for i in result.scalars():
                yield favorite_to_dataclass(i)

    @classmethod
    def insert_item(cls, item: dict[str, Any]):
        # Guard against hash collisions for different item types: the column
        # stores `<type>_<hash>`, callers pass the RAW hash.
        #
        # ⚠️ Prefixing here looks unsafe for the backup restore, which feeds
        # rows that came out of this very table — and for CURRENT backups it is
        # not, because `Favorite.__post_init__` strips the prefix on the way
        # out. The pair only makes sense together; reading either half alone
        # gives a confident wrong answer (AivinNet-Client#451 was filed on
        # exactly that). Round trip pinned in
        # tests_api/test_backup_restore_favorites.py.
        #
        # The prefix is applied only when it is MISSING. Not because a caller
        # passing a prefixed hash exists today — none does, and no backup ever
        # held one either (62097456 introduced the prefix and the strip in the
        # same commit, so before it nothing was prefixed anywhere). It is
        # defence in depth against the one mistake this pair keeps inviting:
        # doubling produces `track_track_…`, which satisfies every constraint
        # and matches no lookup, so it fails SILENTLY — the restore reports
        # success and the favorites are simply gone. #451 was filed on that
        # theory, and the first attempt at fixing it removed the prefixing here
        # and would have written unprefixed rows instead.
        #
        # Safe rather than a guess: a raw hash is a hex digest (`create_hash`,
        # 16 chars) and can never start with `track_`/`album_`/`artist_`.
        prefix = f"{item['type']}_"
        if not item["hash"].startswith(prefix):
            item["hash"] = prefix + item["hash"]

        if item.get("timestamp") is None:
            item["timestamp"] = int(datetime.datetime.now().timestamp())

        if item.get("userid") is None:
            item["userid"] = get_current_userid()

        # Favoriting the same item twice is a no-op, not an error. The client
        # fires /favorites/add on every heart click and treats ANY non-2xx as a
        # failure (client `src/requests/favorite.ts`), so a duplicate must never
        # surface as a 500 — and with the constraint now per user it would be an
        # IntegrityError instead of silently hitting another user's row.
        if cls.row_id(item["hash"], item["userid"]) is not None:
            return None

        return next(cls.execute(insert(cls).values(item), commit=True))

    @classmethod
    def row_id(cls, hash: str, userid: int) -> int | None:
        """
        The row id of an already type-prefixed `hash` for `userid`, or None.

        Selects the id column, not the entity: `Base.execute` hands the result
        out of a session scope, and materializing a mapped entity from it is the
        "identity map is no longer valid" trap (see .claude/rules/database.md).
        """
        result = cls.execute(select(cls.id).where(and_(cls.hash == hash, cls.userid == userid)))

        return next(result).scalar()

    @classmethod
    def remove_item(cls, item: dict[str, Any]):
        # INFO: The userid filter is not optional. Without it, one user removing
        # a favorite deleted the row of EVERY user who had favorited the same
        # item (AivinNet-Client#435).
        userid = item.get("userid")

        if userid is None:
            userid = get_current_userid()

        return next(
            cls.execute(
                delete(cls).where(
                    and_(
                        cls.userid == userid,
                        (cls.hash == item["hash"]) | (cls.hash == f"{item['type']}_{item['hash']}"),
                    )
                ),
                commit=True,
            )
        )

    @classmethod
    def check_exists(cls, hash: str, type: str):
        """
        Whether the CURRENT user has favorited this item.

        Without the user filter this answered "somebody favorited it" — which is
        what made `/favorites/check` show a filled heart on another user's
        favorite, and made album pin/unpin operate on a foreign row.
        """
        result = cls.execute(
            select(cls.id).where(
                and_(
                    cls.userid == get_current_userid(),
                    (cls.hash == hash) | (cls.hash == f"{type}_{hash}"),
                )
            )
        )

        return next(result).scalar() is not None

    @classmethod
    def get_by_hash(cls, hash: str, type: str):
        result = cls.execute(
            select(cls).where(
                and_(
                    cls.userid == get_current_userid(),
                    (cls.hash == hash) | (cls.hash == f"{type}_{hash}"),
                )
            )
        )

        return next(result).scalars().all()

    @classmethod
    def set_extra(cls, hash: str, type: str, extra_updates: dict[str, Any]):
        """
        Merge the given keys into the `extra` JSON of the current user's
        favorite entry (e.g. the sidebar position of a pinned album).
        """
        result = cls.execute(
            select(cls).where(
                and_(
                    cls.type == type,
                    cls.userid == get_current_userid(),
                    (cls.hash == hash) | (cls.hash == f"{type}_{hash}"),
                )
            )
        )

        for row in next(result).scalars().all():
            new_extra = {**(row.extra or {}), **extra_updates}
            next(cls.execute(update(cls).where(cls.id == row.id).values(extra=new_extra), commit=True))

    @classmethod
    def get_all_of_type(cls, type: str, start: int, limit: int):
        result = cls.execute(
            select(cls)
            # .select_from(join(table, cls, field == cls.hash))
            .where(and_(cls.type == type, cls.userid == get_current_userid()))
            .order_by(cls.timestamp.desc())
            .offset(start)
            # INFO: If start is 0, fetch all so we can get the total count
            .limit(limit if start != 0 else None)
        )

        res = next(result).scalars().all()

        if start == 0:
            # if limit == -1, return all
            if limit == -1:
                limit = len(res)

            return res[:limit], len(res)

        return res, -1

    @classmethod
    def get_fav_tracks(cls, start: int, limit: int):
        result, total = cls.get_all_of_type("track", start, limit)
        return favorites_to_dataclass(result), total

    @classmethod
    def get_fav_albums(cls, start: int, limit: int):
        result, total = cls.get_all_of_type("album", start, limit)
        return favorites_to_dataclass(result), total

    @classmethod
    def get_fav_artists(cls, start: int, limit: int):
        result, total = cls.get_all_of_type("artist", start, limit)
        return favorites_to_dataclass(result), total

    @classmethod
    def count_favs_in_period(cls, start_time: int, end_time: int):
        result = cls.execute(
            select(func.count(cls.id))
            .where(cls.userid == get_current_userid())
            .where(and_(cls.timestamp >= start_time, cls.timestamp <= end_time))
        )

        res = next(result).scalar()

        if res:
            return res

        return 0

    @classmethod
    def count_tracks(cls):
        # Both of these feed the "favorites" card on the home page, which is a
        # per-user view — unfiltered they counted every user's favorites.
        result = cls.execute(
            select(func.count(cls.id)).where(and_(cls.type == "track", cls.userid == get_current_userid()))
        )

        return next(result).scalar()

    @classmethod
    def get_last_trackhash(cls):
        result = cls.execute(
            select(cls.hash)
            .where(and_(cls.type == "track", cls.userid == get_current_userid()))
            .order_by(cls.timestamp.desc())
        )

        return next(result).scalar()


class ScrobbleTable(Base):
    __tablename__ = "scrobble"

    id: Mapped[int] = mapped_column(primary_key=True)
    trackhash: Mapped[str] = mapped_column(String(), index=True)
    duration: Mapped[int] = mapped_column(Integer())
    timestamp: Mapped[int] = mapped_column(Integer())
    source: Mapped[str] = mapped_column(String())
    userid: Mapped[int] = mapped_column(Integer(), ForeignKey("user.id", ondelete="cascade"), index=True)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True, default_factory=dict)

    @classmethod
    def add(cls, item: dict[str, Any]):
        if item.get("userid") is None:
            item["userid"] = get_current_userid()

        return cls.insert_one(item)

    @classmethod
    def get_all(cls, start: int, limit: int | None = None, userid: int | None = None):
        result = cls.execute(
            select(cls)
            .where(cls.userid == (userid if userid else get_current_userid()))
            .order_by(cls.timestamp.desc())
            .offset(start)
            .limit(limit)
            .execution_options(yield_per=100)
        )

        for i in next(result).scalars():
            yield tracklog_to_dataclass(i)

    @classmethod
    def get_all_in_period(cls, start_time: int, end_time: int, userid: int | None):
        # UserId will be None if function is called from the API
        # In that case, we use the request userid
        if userid is None:
            userid = get_current_userid()

        result = cls.execute(
            select(cls)
            .where(cls.userid == userid)
            .where(and_(cls.timestamp >= start_time, cls.timestamp <= end_time))
            .order_by(cls.timestamp.desc())
            .execution_options(yield_per=100)
        )

        for i in next(result).scalars():
            yield tracklog_to_dataclass(i)

    @classmethod
    def get_last_entry(cls, userid: int):
        result = cls.execute(select(cls).where(cls.userid == userid).order_by(cls.timestamp.desc()))
        res = next(result).scalar()

        if res:
            return tracklog_to_dataclass(res)


class PlaylistTable(Base):
    __tablename__ = "playlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(), index=True)
    last_updated: Mapped[int] = mapped_column(Integer())
    image: Mapped[str] = mapped_column(String(), nullable=True)
    userid: Mapped[int] = mapped_column(Integer(), ForeignKey("user.id", ondelete="cascade"))
    settings: Mapped[dict[str, Any]] = mapped_column(JSON())
    trackhashes: Mapped[list[str]] = mapped_column(JSON(), default_factory=list)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True, default_factory=dict)

    @classmethod
    def get_all(cls, current_user: bool = True):
        if current_user:
            result = cls.execute(select(cls).where(cls.userid == get_current_userid()).execution_options(yield_per=100))
        else:
            result = cls.execute(select(cls).execution_options(yield_per=100))

        for i in next(result).scalars():
            yield playlist_to_dataclass(i)

    @classmethod
    def add_one(cls, playlist: dict[str, Any]):
        # An owner already on the dict is KEPT. Only the restore sets one, and
        # it has to: an instance backup carries every user's playlists, and
        # overwriting the owner here would hand them all to whoever pressed
        # restore (AivinNet-Client#527). Same rule as `ScrobbleTable.add` and
        # `FavoritesTable.insert_item`; no other caller passes a userid.
        if playlist.get("userid") is None:
            playlist["userid"] = get_current_userid()

        result = cls.insert_one(playlist)

        return result.lastrowid

    @classmethod
    def check_exists_by_name(cls, name: str):
        result = cls.execute(select(cls).where((cls.name == name) & (cls.userid == get_current_userid())))
        return next(result).scalar() is not None

    @classmethod
    def append_to_playlist(cls, id: int, trackhashes: list[str]):
        dbtrackhashes, extra = cls.get_trackhashes_and_extra(id)
        dbtrackhashes = dbtrackhashes or []
        extra = extra or {}

        # Order-preserving de-dup: keep existing order, append new hashes at the
        # end. The old set().union() reshuffled the whole playlist on every add.
        merged = merge_trackhashes(dbtrackhashes, trackhashes)

        # Record when each (genuinely new) track was added, keyed by trackhash
        # in the `extra` JSON. Older entries without a timestamp stay absent
        # (clients render a placeholder for them).
        extra["added_at"] = record_added_at(extra.get("added_at"), dbtrackhashes, merged, int(time.time()))

        return next(
            cls.execute(
                update(cls)
                .where((cls.id == id) & (cls.userid == get_current_userid()))
                .values(trackhashes=merged, extra=extra),
                commit=True,
            )
        )

    @classmethod
    def get_trackhashes(cls, id: int):
        result = cls.execute(select(cls.trackhashes).where((cls.id == id) & (cls.userid == get_current_userid())))
        return next(result).scalar()

    @classmethod
    def get_trackhashes_and_extra(cls, id: int):
        """
        Fetch trackhashes and extra in a single round-trip; used by the
        mutation paths that maintain the added_at map alongside the list.
        """
        result = cls.execute(
            select(cls.trackhashes, cls.extra).where((cls.id == id) & (cls.userid == get_current_userid()))
        )
        row = next(result).first()

        if row is None:
            return None, None

        return row.trackhashes, row.extra

    @classmethod
    def move_in_playlist(cls, id: int, trackhash: str, before_trackhash: str | None):
        """
        Move a single trackhash so it sits immediately before `before_trackhash`
        (or at the end when that is None).

        The trackhash SET is unchanged, so `extra["added_at"]` needs no pruning.
        Raises `TrackhashNotInPlaylist` when either anchor is unknown.
        """
        dbtrackhashes = cls.get_trackhashes(id)

        if not dbtrackhashes:
            raise TrackhashNotInPlaylist(trackhash)

        moved = move_trackhash(dbtrackhashes, trackhash, before_trackhash)

        return next(
            cls.execute(
                update(cls).where((cls.id == id) & (cls.userid == get_current_userid())).values(trackhashes=moved),
                commit=True,
            )
        )

    @classmethod
    def remove_from_playlist(cls, id: int, trackhashes: list[dict[str, Any]]):
        # INFO: Get db trackhashes
        dbtrackhashes, extra = cls.get_trackhashes_and_extra(id)
        if dbtrackhashes:
            # Removal is by trackhash; the client-supplied index is only a hint
            # for picking between duplicates. Matching on the index alone made
            # every removal a silent no-op as soon as the playlist held an orphan
            # hash (client index counts resolved tracks, the stored list doesn't).
            dbtrackhashes = remove_trackhashes(dbtrackhashes, trackhashes)

            values: dict[str, Any] = {"trackhashes": dbtrackhashes}

            # Keep the added_at map in sync so removed hashes don't linger
            # (and a later re-add gets a fresh timestamp).
            if extra and extra.get("added_at"):
                extra["added_at"] = prune_added_at(extra["added_at"], dbtrackhashes)
                values["extra"] = extra

            return next(
                cls.execute(
                    update(cls).where((cls.id == id) & (cls.userid == get_current_userid())).values(values),
                    commit=True,
                )
            )

    @classmethod
    def get_by_id(cls, id: int):
        result = cls.execute(select(cls).where((cls.id == id) & (cls.userid == get_current_userid())))
        result = next(result).scalar()

        if result:
            return playlist_to_dataclass(result)

    @classmethod
    def update_one(cls, id: int, playlist: dict[str, Any]):
        return next(
            cls.execute(
                update(cls).where((cls.id == id) & (cls.userid == get_current_userid())).values(playlist),
                commit=True,
            )
        )

    @classmethod
    def update_settings(cls, id: int, settings: dict[str, Any]):
        return next(
            cls.execute(
                update(cls).where((cls.id == id) & (cls.userid == get_current_userid())).values(settings=settings),
                commit=True,
            )
        )

    @classmethod
    def remove_image(cls, id: int):
        return next(
            cls.execute(
                update(cls).where((cls.id == id) & (cls.userid == get_current_userid())).values(image=None),
                commit=True,
            )
        )

    @classmethod
    def remove_one(cls, id: int):
        """
        Delete a playlist — the caller's own, and only that one.

        ⚠️ This override is the point. `Base.remove_one` matches on the primary
        key alone, and playlist ids come from ONE sequence shared by every
        account, so inheriting it meant any logged-in user could walk ids and
        delete other people's playlists. Every other mutator in this class was
        already scoped; this one was not, and nothing about the call site made
        that visible.
        """
        return next(
            cls.execute(
                delete(cls).where((cls.id == id) & (cls.userid == get_current_userid())),
                commit=True,
            )
        )


class LibDataTable(Base):
    __tablename__ = "artistdata"

    id: Mapped[int] = mapped_column(primary_key=True)
    itemhash: Mapped[str] = mapped_column(String(), unique=True, index=True)
    itemtype: Mapped[str] = mapped_column(String())
    color: Mapped[str] = mapped_column(String(), nullable=True)
    bio: Mapped[str] = mapped_column(String(), nullable=True)
    info: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True, default_factory=dict)

    @classmethod
    def update_one(cls, hash: str, data: dict[str, Any]):
        return next(cls.execute(update(cls).where(cls.itemhash == hash).values(data), commit=True))

    @classmethod
    def find_one(cls, hash: str, type: Literal["album", "artist"]):
        result = cls.execute(select(cls).where((cls.itemhash == type + hash) & (cls.itemtype == type)))
        return next(result).scalar()

    @classmethod
    def get_all_colors(cls, type: str) -> Iterable[dict[str, str]]:
        result = cls.execute(select(cls).where(cls.itemtype == type))

        for i in next(result).scalars():
            yield {"itemhash": i.itemhash.replace(type, ""), "color": i.color}


class CollectionTable(Base):
    # INFO: table name was kept as page to avoid breaking existing data
    __tablename__ = "page"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(), index=True)
    userid: Mapped[int] = mapped_column(Integer(), ForeignKey("user.id", ondelete="cascade"), index=True)
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default_factory=list)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=True, default_factory=dict)

    @classmethod
    def to_dict(cls, entry: Any) -> dict[str, Any]:
        d = entry.__dict__
        del d["_sa_instance_state"]
        return d

    @classmethod
    def get_all(cls, current_user: bool = True):
        # `current_user=False` is the instance backup (AivinNet-Client#527) and
        # nothing else — the homepage store, the only other caller, wants the
        # requesting user's collections, so the default stays as it was. Same
        # shape as `PlaylistTable.get_all`.
        if current_user:
            result = cls.execute(select(cls).where(cls.userid == get_current_userid()))
        else:
            result = cls.execute(select(cls))

        for i in next(result).scalars():
            yield cls.to_dict(i)

    @classmethod
    def get_by_id(cls, id: int):
        result = cls.execute(select(cls).where(and_(cls.id == id, cls.userid == get_current_userid())))
        res = next(result).scalar()

        if res:
            return cls.to_dict(res)

    @classmethod
    def delete_by_id(cls, id: int):
        return next(
            cls.execute(
                delete(cls).where(and_(cls.id == id, cls.userid == get_current_userid())),
                commit=True,
            )
        )

    @classmethod
    def update_items(cls, id: int, items: list[dict[str, Any]]):
        return next(
            cls.execute(
                update(cls).where(and_(cls.id == id, cls.userid == get_current_userid())).values(items=items),
                commit=True,
            )
        )

    @classmethod
    def update_one(cls, payload: dict[str, Any]):
        return next(
            cls.execute(
                update(cls).where(and_(cls.id == payload["id"], cls.userid == get_current_userid())).values(payload),
                commit=True,
            )
        )


class PlaylistFolderTable(Base):
    """
    A user-created folder for grouping playlists in the library sidebar.

    Flat (no nesting) for v1. `items` is the ordered list of playlist ids the
    folder contains (manual drag order); a playlist lives in at most one folder.
    Deleting a folder does NOT delete its playlists — they just stop being
    referenced here and fall back to the top level.
    """

    __tablename__ = "playlistfolder"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String())
    userid: Mapped[int] = mapped_column(Integer(), ForeignKey("user.id", ondelete="cascade"), index=True)
    items: Mapped[list[int]] = mapped_column(JSON(), default_factory=list)
    position: Mapped[int] = mapped_column(Integer(), default=0)

    @classmethod
    def to_dict(cls, entry: Any) -> dict[str, Any]:
        return {
            "id": entry.id,
            "name": entry.name,
            "items": entry.items or [],
            "position": entry.position,
        }

    @classmethod
    def get_all(cls):
        result = cls.execute(select(cls).where(cls.userid == get_current_userid()).order_by(cls.position))

        for i in next(result).scalars():
            yield cls.to_dict(i)

    @classmethod
    def get_by_id(cls, id: int):
        result = cls.execute(select(cls).where(and_(cls.id == id, cls.userid == get_current_userid())))
        res = next(result).scalar()

        if res:
            return cls.to_dict(res)

    @classmethod
    def create(cls, name: str, position: int):
        result = cls.insert_one({"name": name, "userid": get_current_userid(), "items": [], "position": position})
        return result.lastrowid

    @classmethod
    def delete_by_id(cls, id: int):
        return next(
            cls.execute(
                delete(cls).where(and_(cls.id == id, cls.userid == get_current_userid())),
                commit=True,
            )
        )

    @classmethod
    def update_one(cls, id: int, values: dict[str, Any]):
        return next(
            cls.execute(
                update(cls).where(and_(cls.id == id, cls.userid == get_current_userid())).values(values),
                commit=True,
            )
        )


class DeviceTable(Base):
    """
    A user's paired playback device (phone/desktop/…), used by the multiroom
    "Group Session" feature for the persistent device registry.

    `device_id` is a client-generated UUID (stable across reloads); the live
    session state (who is joined, now-playing, presence) lives purely in RAM in
    `lib.groupsession` and is intentionally NOT persisted here. Purely additive:
    the table auto-creates via `create_all_tables()`.
    """

    __tablename__ = "device"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(String(), index=True)
    userid: Mapped[int] = mapped_column(Integer(), ForeignKey("user.id", ondelete="cascade"), index=True)
    name: Mapped[str] = mapped_column(String())
    type: Mapped[str] = mapped_column(String())
    last_seen: Mapped[int] = mapped_column(Integer(), default=0)
    created: Mapped[int] = mapped_column(Integer(), default=0)

    @classmethod
    def to_dict(cls, entry: Any) -> dict[str, Any]:
        return {
            "device_id": entry.device_id,
            "userid": entry.userid,
            "name": entry.name,
            "type": entry.type,
            "last_seen": entry.last_seen,
            "created": entry.created,
        }

    @classmethod
    def upsert(cls, device_id: str, userid: int, name: str, type: str):
        """
        Insert a new device row or, when one already exists for this
        (device_id, userid), refresh its name/type/last_seen.

        NOTE: the lookup selects the ID COLUMN, never the mapped entity.
        `Base.execute` yields its result out of a closed session scope, so
        materialising an ORM object here raised "identity map is no longer
        valid" — i.e. every re-registration of a known device answered 500.
        """
        now = int(time.time())
        existing = next(
            cls.execute(select(cls.id).where(and_(cls.device_id == device_id, cls.userid == userid)))
        ).scalar()

        if existing:
            return next(
                cls.execute(
                    update(cls).where(cls.id == existing).values(name=name, type=type, last_seen=now),
                    commit=True,
                )
            )

        return cls.insert_one(
            {
                "device_id": device_id,
                "userid": userid,
                "name": name,
                "type": type,
                "last_seen": now,
                "created": now,
            }
        )

    @classmethod
    def get_all_for_user(cls, userid: int) -> list[dict[str, Any]]:
        # Columns, not the mapped entity: rows must stay readable after the
        # session that produced them is gone (see the note on `upsert`).
        columns = ("device_id", "userid", "name", "type", "last_seen", "created")
        rows = next(
            cls.execute(
                select(cls.device_id, cls.userid, cls.name, cls.type, cls.last_seen, cls.created)
                .where(cls.userid == userid)
                .order_by(cls.created)
            )
        ).all()
        return [dict(zip(columns, row, strict=True)) for row in rows]

    @classmethod
    def touch(cls, device_id: str, userid: int, timestamp: int):
        return next(
            cls.execute(
                update(cls).where(and_(cls.device_id == device_id, cls.userid == userid)).values(last_seen=timestamp),
                commit=True,
            )
        )
