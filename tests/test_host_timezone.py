"""A host timezone that cannot be read does not break the server (2026-10-07).

Installing tzdata into an Ubuntu 24.04 container without a timezone wrote
"/UTC" into /etc/timezone. pendulum raised on it in local_timezone(), and every
page that dates something relative to now answered 500.
"""

import sys

import pendulum
import pytest

from aivinnet.utils.timezone import ensure_local_timezone


@pytest.fixture()
def system_timezone(monkeypatch):
    """Replace what pendulum reads from the host; forget what it cached."""
    module = sys.modules["pendulum.tz.local_timezone"]
    monkeypatch.setattr(module, "_local_timezone", None)
    monkeypatch.setattr(module, "_mock_local_timezone", None)

    def use(reader):
        monkeypatch.setattr(module, "_get_system_timezone", reader)

    return use


def test_an_unreadable_host_timezone_falls_back_to_utc(system_timezone):
    def broken():
        raise ValueError("ZoneInfo keys may not be absolute paths, got: /UTC")

    system_timezone(broken)
    with pytest.raises(ValueError):
        pendulum.now()  # what every dated page ran into

    ensure_local_timezone()

    assert pendulum.now().timezone_name == "UTC"


def test_a_readable_host_timezone_is_kept(system_timezone):
    system_timezone(lambda: pendulum.timezone("Europe/Berlin"))

    ensure_local_timezone()

    assert pendulum.now().timezone_name == "Europe/Berlin"
