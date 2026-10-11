"""The rescan wiring carries a favourite across a changed hash (#433).

`lib/rescan_remap.py` decides what moves; this checks the rescan actually calls
it, against the real database. The scan itself (IndexTracks) is not run: the
store is set to the state a scan leaves behind, and `_carry_references` runs
on it.
"""

from types import SimpleNamespace

from sqlalchemy import insert, select

OLD = "0ld0ld0ld0ld0ld0"
NEW = "n3wn3wn3wn3wn3w0"
FILE = "/m/Gothic/swamp camp.mp3"


def test_a_rescan_that_changed_a_hash_carries_the_favourite(playlist_db, monkeypatch):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable
    from aivinnet.lib import index
    from aivinnet.store.tracks import TrackStore

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{OLD}", type="track", timestamp=1, userid=1, extra={})
        )

    # The store after the scan: the same file, under the hash its new tags give.
    after = {NEW: SimpleNamespace(tracks=[SimpleNamespace(filepath=FILE, trackhash=NEW)])}
    monkeypatch.setattr(TrackStore, "trackhashmap", after)

    index._carry_references({FILE: OLD})

    with DbEngine.manager() as session:
        assert session.execute(select(FavoritesTable.hash)).scalars().all() == [f"track_{NEW}"]


def test_a_rescan_that_changed_nothing_touches_nothing(playlist_db, monkeypatch):
    from aivinnet.db.engine import DbEngine
    from aivinnet.db.userdata import FavoritesTable
    from aivinnet.lib import index
    from aivinnet.store.tracks import TrackStore

    with DbEngine.manager(commit=True) as session:
        session.execute(
            insert(FavoritesTable).values(hash=f"track_{OLD}", type="track", timestamp=1, userid=1, extra={})
        )

    same = {OLD: SimpleNamespace(tracks=[SimpleNamespace(filepath=FILE, trackhash=OLD)])}
    monkeypatch.setattr(TrackStore, "trackhashmap", same)

    index._carry_references({FILE: OLD})

    with DbEngine.manager() as session:
        assert session.execute(select(FavoritesTable.hash)).scalars().all() == [f"track_{OLD}"]
