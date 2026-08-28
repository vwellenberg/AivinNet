"""The release-fetch path, for the cases that used to end the process.

This runs at startup, before the port is bound, and a container restarts it for
ever — so "it raised" is not a neutral outcome here. Each of these was reachable
from outside with no credentials at all.
"""

from unittest.mock import patch

import pytest

from aivinnet.settings import AssetHandler


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture()
def client_dir(tmp_path, monkeypatch):
    class FakePaths:
        client_path = tmp_path

    monkeypatch.setattr("aivinnet.settings.Paths", lambda: FakePaths())

    # `Metadata.version` asks importlib for the installed distribution, which the
    # fast lane does not have — it raises rather than returning a version, so any
    # test reaching the tag comparison would fail for an unrelated reason.
    class FakeMetadata:
        version = "2026.8.1"

    monkeypatch.setattr("aivinnet.settings.Metadata", FakeMetadata)
    return tmp_path


def test_a_rate_limited_answer_does_not_raise(client_dir):
    """⚠️ Past 60 requests/hour GitHub answers 403 with a JSON *object*.
    Iterating that yields strings, so `release["tag_name"]` raised TypeError
    straight out of startup — a crash loop under `restart: unless-stopped`."""
    body = {"message": "API rate limit exceeded", "documentation_url": "https://…"}

    with patch("aivinnet.settings.requests.get", return_value=FakeResponse(body)):
        assert AssetHandler.download_client_from_github() is False


def test_an_empty_release_list_does_not_raise(client_dir):
    """A fresh repo, or a filtered response: `releases[0]` was an IndexError."""
    with patch("aivinnet.settings.requests.get", return_value=FakeResponse([])):
        assert AssetHandler.download_client_from_github() is False


def test_junk_entries_are_skipped(client_dir):
    """Defensive: anything that is not a release object must not be indexed into."""
    with patch("aivinnet.settings.requests.get", return_value=FakeResponse(["nonsense", 42, None])):
        assert AssetHandler.download_client_from_github() is False


def test_a_prerelease_is_not_used_as_the_fallback(client_dir):
    """⚠️ An -rcN run publishes a real release whose client is a test build.
    Taking releases[0] blindly would unpack that into the persistent config
    directory of every container whose own version is not findable — and keep it.
    """
    releases = [
        {"tag_name": "v2026.9.0-rc1", "prerelease": True, "assets": []},
        {"tag_name": "v2026.8.0", "prerelease": False, "assets": []},
    ]
    seen = []

    def remember(release, path):
        seen.append(release["tag_name"])
        return False

    with (
        patch("aivinnet.settings.requests.get", return_value=FakeResponse(releases)),
        patch.object(AssetHandler, "process_release", side_effect=remember),
    ):
        AssetHandler.download_client_from_github()

    assert seen == ["v2026.8.0"], f"fallback picked {seen}, expected the stable release"


def test_nothing_but_prereleases_is_refused(client_dir):
    """Better no client than a test build in someone's data directory."""
    releases = [{"tag_name": "v2026.9.0-rc1", "prerelease": True, "assets": []}]

    with patch("aivinnet.settings.requests.get", return_value=FakeResponse(releases)):
        assert AssetHandler.download_client_from_github() is False
