from aivinnet.db.userdata import ScrobbleTable
from aivinnet.lib.home.create_items import create_items
from aivinnet.models.logger import TrackLog

BATCH_SIZE = 200
MAX_BATCHES = 20


def get_recently_played(limit: int, userid: int | None = None, _entries: list[TrackLog] | None = None):
    """
    Get the recently played items for the homepage.

    Pass a list of track log entries to use a subset of the scrobble table.

    The history is read in batches, with ONE set of sources already shown
    across all of them (#391). Each batch used to start a fresh set, and the
    stop test asked a generator whether it was empty (never): three albums on
    repeat came out as the same three cards, batch after batch.
    """
    if _entries:
        # Only the given entries: this runs inside the scrobble request.
        return create_items(_entries, 1, userid)

    items: list = []
    added: set[str] = set()

    for batch in range(MAX_BATCHES):
        if len(items) >= limit:
            break

        entries = list(ScrobbleTable.get_all(batch * BATCH_SIZE, BATCH_SIZE, userid=userid))
        items.extend(create_items(entries, limit - len(items), userid, added))

        if len(entries) < BATCH_SIZE:
            break

    return items
