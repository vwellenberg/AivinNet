import logging

from swingmusic.db.userdata import UserTable
from swingmusic.lib.recipes import HomepageRoutine
from swingmusic.plugins.mixes import MixesPlugin
from swingmusic.store.homepage import HomepageStore

# NOTE: not `from swingmusic.logger import log` — that global is None until
# setup_logger() runs and an imported name never picks up the reassignment.
log = logging.getLogger(__name__)


class ArtistMixes(HomepageRoutine):
    store_key = "artist_mixes"

    @property
    def is_valid(self):
        return MixesPlugin().enabled

    def run(self):
        users = UserTable.get_all()

        for user in users:
            mix = MixesPlugin()
            mixes = mix.create_artist_mixes(user.id)

            if not mixes:
                # Nothing generated — leave whatever the store already holds
                # (seeded from the database at boot) rather than blanking it.
                #
                # ⚠️ SAY SO. This branch is the reason an empty homepage row is
                # so hard to read: create_artist_mixes() returns [] whenever the
                # remote recommendation server is unreachable or answers with
                # something that is not JSON, and without a line here the result
                # is a store that looks exactly as if the job had never run.
                # That misreading cost a full diagnosis once — the journal said
                # nothing, so the scheduler was blamed instead of the 502.
                log.warning(
                    "No artist mixes generated for user %s — the homepage row will keep "
                    "whatever was seeded from the database. Check the lines above for "
                    "'Failed to connect/decode ... recommendation server'.",
                    user.id,
                )
                continue

            HomepageStore.set_mixes(mixes, entrykey=self.store_key, userid=user.id)

            custom_mixes = []
            for _mix in mixes:
                custom_mix = MixesPlugin.get_track_mix(_mix)

                if custom_mix:
                    custom_mixes.append(custom_mix)

            HomepageStore.set_mixes(custom_mixes, entrykey="custom_mixes", userid=user.id)

    def __init__(self) -> None:
        super().__init__()
