"""The switch that decides whether a scan may talk to the internet.

Two outbound calls hang off it — artist images from Deezer, similar artists
from Last.fm — and both are triggered by indexing rather than by a person, so
the default has to be off and the gate has to be checked in the right order.
"""

from unittest.mock import patch

from aivinnet.config import UserConfig
from aivinnet.lib.populate import may_fetch_online_metadata


class _Config:
    def __init__(self, enabled):
        self.enableOnlineMetadata = enabled


class TestMayFetchOnlineMetadata:
    def test_off_by_default(self):
        # The field default, read off the dataclass rather than an instance, so
        # no config file or singleton is involved.
        default = next(f for f in UserConfig.__dataclass_fields__.values() if f.name == "enableOnlineMetadata")
        assert default.default is False

    def test_disabled_config_blocks_even_with_a_connection(self):
        with (
            patch("aivinnet.lib.populate.UserConfig", lambda: _Config(False)),
            patch("aivinnet.lib.populate.has_connection", return_value=True),
        ):
            assert may_fetch_online_metadata() is False

    def test_enabled_config_still_needs_a_connection(self):
        with (
            patch("aivinnet.lib.populate.UserConfig", lambda: _Config(True)),
            patch("aivinnet.lib.populate.has_connection", return_value=False),
        ):
            assert may_fetch_online_metadata() is False

    def test_enabled_and_connected_goes_ahead(self):
        with (
            patch("aivinnet.lib.populate.UserConfig", lambda: _Config(True)),
            patch("aivinnet.lib.populate.has_connection", return_value=True),
        ):
            assert may_fetch_online_metadata() is True

    def test_a_disabled_instance_never_probes_the_network(self):
        """
        Order matters, not just the result. `has_connection()` opens a socket;
        an instance with the setting off should be indistinguishable from one
        with no internet at all, so the config must short-circuit first.
        """
        with (
            patch("aivinnet.lib.populate.UserConfig", lambda: _Config(False)),
            patch("aivinnet.lib.populate.has_connection", return_value=True) as probe,
        ):
            may_fetch_online_metadata()

        probe.assert_not_called()
