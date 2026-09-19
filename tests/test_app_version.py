"""Where the running version comes from, and what happens when nobody knows it.

The version is not cosmetic: it picks the release a Docker install downloads its
web client from, and it decides whether the client on disk counts as stale
(`AssetHandler.client_is_stale`). Issue #192:

* the Docker image's pip metadata said ``0.0.0`` (built without ``.git``), and
  the fallback then opened ``version.txt`` relative to the WORKING DIRECTORY —
  ``docker run -w /tmp … --version`` died with FileNotFoundError, and so did
  anything else started outside ``/app``;
* that file was a hand-maintained copy that had not been bumped since v2026.8.2,
  so every image built without the release workflow reported 2026.8.2.

The version now has exactly one source — the installed distribution's metadata,
which the Docker build fills from ``--build-arg app_version`` — and an unknown
version is reported as ``0.0.0`` instead of crashing.
"""

from importlib import metadata

import pytest

from aivinnet import settings
from aivinnet.settings import AssetHandler, Metadata


@pytest.fixture()
def installed_as(monkeypatch):
    """Pretend the installed `aivinnet` distribution reports `value` (or is absent)."""

    def install(value):
        def fake_version(name):
            assert name == "aivinnet"
            if value is None:
                raise metadata.PackageNotFoundError(name)
            return value

        monkeypatch.setattr("aivinnet.settings.metadata.version", fake_version)

    return install


class TestMetadataVersion:
    def test_the_installed_version_is_reported(self, installed_as):
        installed_as("2026.8.5")
        assert Metadata.version == "2026.8.5"

    def test_an_unversioned_build_does_not_depend_on_the_working_directory(self, installed_as, tmp_path, monkeypatch):
        """⚠️ The #192 crash: metadata 0.0.0 used to mean `open("version.txt")`
        relative to the CWD, so any workdir but /app raised FileNotFoundError —
        at import time of `__main__`, i.e. even for `--version` and `--help`."""
        installed_as("0.0.0")
        monkeypatch.chdir(tmp_path)

        assert Metadata.version == "0.0.0"

    def test_a_stray_version_file_in_the_working_directory_is_ignored(self, installed_as, tmp_path, monkeypatch):
        """Whatever happens to lie in the CWD is not the app's version — the
        old fallback reported the stale committed copy this way."""
        installed_as("0.0.0")
        (tmp_path / "version.txt").write_text("2026.8.2\n", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        assert Metadata.version == "0.0.0"

    def test_running_from_a_source_tree_without_install_does_not_crash(self, installed_as):
        """No distribution at all (a bare checkout on sys.path, as this test lane
        runs): unknown, not fatal."""
        installed_as(None)
        assert Metadata.version == "0.0.0"


class TestReleaseMatchesVersion:
    """setuptools-scm normalises the version (PEP 440), release tags do not.

    ``v2026.8.1-rc1`` is installed as ``2026.8.1rc1``. The old raw-string
    comparison only worked in Docker because version.txt carried the tag
    verbatim; with the version coming from the metadata, an rc image would no
    longer find its own release and fall back to the latest STABLE client.
    """

    @pytest.mark.parametrize(
        ("tag", "version"),
        [
            ("v2026.8.5", "2026.8.5"),
            ("v2026.8.1-rc1", "2026.8.1rc1"),
            ("v2026.8.1-rc.1", "2026.8.1rc1"),
            ("V2026.8.1RC1", "2026.8.1rc1"),
        ],
    )
    def test_matches(self, tag, version):
        assert settings.release_matches_version(tag, version)

    @pytest.mark.parametrize(
        ("tag", "version"),
        [
            ("v2026.8.50", "2026.8.5"),
            ("v2026.8.5", "2026.8.50"),
            ("v2026.8.1-rc1", "2026.8.1"),
            ("v2026.8.1-rc1", "2026.8.1rc2"),
            (None, "2026.8.5"),
            (42, "2026.8.5"),
        ],
    )
    def test_does_not_match(self, tag, version):
        assert not settings.release_matches_version(tag, version)


def test_an_rc_install_fetches_its_own_release(monkeypatch, tmp_path):
    """The lookup, end to end: the rc build must pick the rc release, not the
    stable fallback (which is the only other thing it would ever get)."""

    class FakePaths:
        client_path = tmp_path

    class FakeMetadata:
        version = "2026.9.0rc1"

    class FakeResponse:
        def json(self):
            return [
                {"tag_name": "v2026.9.0-rc1", "prerelease": True, "assets": []},
                {"tag_name": "v2026.8.5", "prerelease": False, "assets": []},
            ]

    seen = []
    monkeypatch.setattr("aivinnet.settings.Paths", lambda: FakePaths())
    monkeypatch.setattr("aivinnet.settings.Metadata", FakeMetadata)
    monkeypatch.setattr("aivinnet.settings.requests.get", lambda *a, **k: FakeResponse())
    monkeypatch.setattr(AssetHandler, "process_release", lambda release, path: seen.append(release["tag_name"]) or True)

    assert AssetHandler.download_client_from_github() == "v2026.9.0-rc1"
    assert seen == ["v2026.9.0-rc1"]
