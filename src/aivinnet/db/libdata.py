from collections.abc import Callable
from typing import Any

from sqlalchemy import JSON, Integer, String, delete, insert, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from aivinnet.config import UserConfig
from aivinnet.db import Base
from aivinnet.db.engine import DbEngine
from aivinnet.db.utils import track_to_dataclass

# Well below SQLite's 32 766 bound variables per statement.
_PATHS_PER_STATEMENT = 900


class TrackTable(Base):
    __tablename__ = "track"

    id: Mapped[int] = mapped_column(init=False, primary_key=True)
    album: Mapped[str] = mapped_column(String())
    albumartists: Mapped[str] = mapped_column(String())
    albumhash: Mapped[str] = mapped_column(String(), index=True)
    artists: Mapped[str] = mapped_column(String())
    bitrate: Mapped[int] = mapped_column(Integer())
    copyright: Mapped[str | None] = mapped_column(String())
    date: Mapped[int] = mapped_column(Integer(), nullable=True)
    disc: Mapped[int] = mapped_column(Integer())
    duration: Mapped[int] = mapped_column(Integer())
    filepath: Mapped[str] = mapped_column(String(), index=True, unique=True)
    folder: Mapped[str] = mapped_column(String(), index=True)
    genres: Mapped[str | None] = mapped_column(String())
    last_mod: Mapped[float] = mapped_column(Integer())
    title: Mapped[str] = mapped_column(String())
    track: Mapped[int] = mapped_column(Integer())
    trackhash: Mapped[str] = mapped_column(String(), index=True)
    lastplayed: Mapped[int] = mapped_column(Integer(), default=0)
    playcount: Mapped[int] = mapped_column(Integer(), default=0)
    playduration: Mapped[int] = mapped_column(Integer(), default=0)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSON(), default_factory=dict)

    @classmethod
    def get_all(cls):
        with DbEngine.manager() as conn:
            config = UserConfig()
            result = conn.execute(select(cls).execution_options(yield_per=100))

            # Closed explicitly, like `Base.execute` (db/__init__.py): a caller
            # that stops early must not leave the stream's cursor on the pool.
            try:
                for i in result.scalars():
                    d = i.__dict__
                    del d["_sa_instance_state"]

                    yield track_to_dataclass(d, config)
            finally:
                result.close()

    @classmethod
    def update_filepath(cls, old: str, new: str) -> int:
        """
        Point a track's row at its renamed file. Returns the rows changed.

        Only the path: `last_mod` stays, and that is what lets the next rescan
        recognise the file as unchanged (a rename keeps the mtime) instead of
        dropping the row and indexing it again from scratch.
        """
        with DbEngine.manager(commit=True) as conn:
            result = conn.execute(update(TrackTable).where(TrackTable.filepath == old).values(filepath=new))
            return result.rowcount

    @classmethod
    def replace_by_filepath(cls, tags: dict[str, Any], also: Callable[[Session], None] | None = None) -> int:
        """
        Swap the row of ``tags["filepath"]`` for one built from ``tags``, in ONE
        transaction, and return the new row id.

        ``also`` runs inside the same transaction, so whatever has to change
        together with the row (a tag edit repointing playlists) commits or rolls
        back with it. Done as a DELETE and an INSERT in separate commits, a
        failure in between (a locked database, live on 2026-09-30) left the
        file on disk and no row for it: the track was gone from the library.
        """
        with DbEngine.manager(commit=True) as session:
            session.execute(delete(cls).where(cls.filepath == tags["filepath"]))
            result = session.execute(insert(cls).values(tags))
            if also is not None:
                also(session)
            return result.inserted_primary_key[0]

    @classmethod
    def remove_tracks_by_filepaths(cls, filepaths: set[str]):
        # In chunks, in one transaction: one `IN (...)` binds a variable per
        # path, and SQLite refuses more than 32 766. A library above that whose
        # paths all moved at once (a new mount point) kept every stale row.
        paths = list(filepaths)
        with DbEngine.manager(commit=True) as conn:
            for start in range(0, len(paths), _PATHS_PER_STATEMENT):
                chunk = paths[start : start + _PATHS_PER_STATEMENT]
                conn.execute(delete(TrackTable).where(TrackTable.filepath.in_(chunk)))
