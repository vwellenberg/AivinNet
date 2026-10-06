from typing import Any

from sqlalchemy import (
    delete,
    func,
    insert,
    select,
)
from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass

from aivinnet.db.engine import DbEngine


class Base(MappedAsDataclass, DeclarativeBase):
    """
    Base class for all database models.

    It has methods common to all tables. eg. `insert_one`, `insert_many`, `remove_all`, `remove_one`, `all`, `count`.
    """

    @classmethod
    def execute(cls, stmt: Any, commit: bool = False):
        with DbEngine.manager(commit=commit) as session:
            result = session.execute(stmt.execution_options(yield_per=100))

            # ⚠️ Read the rows out BEFORE the connection goes back to the pool.
            # Callers take `next(cls.execute(...))` and read the result after
            # this generator — and its session — are gone. With a streamed
            # (`yield_per`) result that left the SQLite statement open on the
            # pooled connection, holding a read snapshot. Since SQLAlchemy 2.1
            # (#289) closing the session no longer finalizes it, and Python
            # >= 3.11 no longer resets statements on rollback. The next writer
            # handed that connection failed at once with "database is locked"
            # as soon as anything else had written meanwhile: favourites,
            # scrobbles, device registration, pins — intermittently, and the
            # second click worked because it got another connection (live,
            # 2026-09-29 to 10-06). A frozen result holds every row and no
            # cursor; DML results return no rows and hold none either.
            if getattr(result, "returns_rows", True):
                result = result.freeze()()

            if commit:
                session.commit()

            yield result

    @classmethod
    def insert_many(cls, items: list[dict[str, Any]]):
        """
        Inserts multiple items into the database.
        """
        return next(cls.execute(insert(cls).values(items), commit=True))

    @classmethod
    def insert_one(cls, item: dict[str, Any]):
        """
        Inserts a single item into the database.
        """
        return cls.insert_many([item])

    @classmethod
    def remove_all(cls):
        return next(cls.execute(delete(cls), commit=True))

    @classmethod
    def remove_one(cls, id: int):
        return next(cls.execute(delete(cls).where(cls.id == id), commit=True))

    @classmethod
    def all(cls):
        return next(cls.execute(select(cls).execution_options(yield_per=100)))

    @classmethod
    def count(cls):
        return next(cls.execute(select(func.count()).select_from(cls))).scalar()


def create_all_tables():
    """
    Creates all the tables that build on the Base class.
    """
    Base().metadata.create_all(DbEngine.engine)
