"""The unpacked web client must be refreshed when the backend moves on.

`setup_default_client` used to ask only whether an `index.html` existed. The
client lives in the CONFIG directory, which outlives every upgrade — for a
container it is a mounted volume that outlives the image — so a new backend
served the previous release's interface, silently, for ever
(AivinNet-Client#551). Reproduced against the real image: a fresh volume with
v2026.8.1 downloads once, and the upgrade to v2026.8.2 downloads zero times.

⚠️ The fix that had to be pulled back once did the opposite of this one: it
treated "no stamp" as "stale". These tests exist mostly to pin the cases that
made that unshippable — an AppImage on read-only squashfs, a hand-deployed
build, a stamp that cannot be written, and a fallback download that would
re-run on every restart.
"""

import json
import zipfile

import pytest

from aivinnet.settings import AssetHandler, Paths


@pytest.fixture()
def config(monkeypatch, tmp_path):
    """
    Point Paths at a throwaway directory and let the test set the version.

    ⚠️ Patched on the INSTANCE, not the class. `Paths` is a singleton and sets
    `client_path` as an instance attribute in `__init__`, so a class-level patch
    is shadowed by whatever instance another test module already created — the
    ownership check then compared the real client path against a fake config dir,
    decided the directory was foreign, and every staleness test quietly passed
    for the wrong reason.
    """
    client = tmp_path / "client"
    client.mkdir(parents=True)
    (client / "index.html").write_text("<!doctype html>")

    paths = Paths()
    monkeypatch.setattr(type(paths), "config_dir", property(lambda self: tmp_path), raising=False)
    monkeypatch.setattr(paths, "client_path", client, raising=False)

    def set_version(v):
        monkeypatch.setattr("aivinnet.settings.Metadata.version", v, raising=False)

    set_version("2026.8.2")

    return tmp_path, client, set_version


class TestStaleness:
    def test_an_unstamped_client_is_left_alone(self, config):
        """
        ⚠️ THE rule. "Unknown provenance" must mean restraint, not action — this
        is what protects the AppImage's read-only client and anyone who deployed
        their own build.
        """
        assert AssetHandler.client_is_stale() is False

    def test_a_stamp_from_this_version_is_current(self, config):
        AssetHandler.stamp_client("v2026.8.2")

        assert AssetHandler.client_is_stale() is False

    def test_a_stamp_from_an_older_version_is_stale(self, config):
        _tmp, _client, set_version = config

        AssetHandler.stamp_client("v2026.8.1")
        set_version("2026.8.3")

        assert AssetHandler.client_is_stale() is True

    def test_an_unreadable_stamp_is_left_alone(self, config):
        """A corrupt stamp must not turn into an endless refresh."""
        tmp, _client, _set = config
        (tmp / AssetHandler.CLIENT_STAMP_NAME).write_text("{not json")

        assert AssetHandler.client_is_stale() is False


class TestOwnership:
    def test_a_custom_client_directory_is_never_managed(self, monkeypatch, tmp_path):
        """
        `--client` / `AIVINNET_CLIENT_DIR`: the AppImage's read-only squashfs,
        and anyone running their own build. No stamp is written and nothing is
        judged stale.
        """
        paths = Paths()
        monkeypatch.setattr(type(paths), "config_dir", property(lambda self: tmp_path), raising=False)
        monkeypatch.setattr(paths, "client_path", tmp_path / "somewhere-else", raising=False)

        assert AssetHandler.client_stamp_path() is None
        assert AssetHandler.client_is_stale() is False

    def test_stamping_a_foreign_directory_writes_nothing(self, monkeypatch, tmp_path):
        paths = Paths()
        monkeypatch.setattr(type(paths), "config_dir", property(lambda self: tmp_path), raising=False)
        monkeypatch.setattr(paths, "client_path", tmp_path / "elsewhere", raising=False)

        AssetHandler.stamp_client("v2026.8.2")

        assert not (tmp_path / AssetHandler.CLIENT_STAMP_NAME).exists()

    def test_an_unwritable_stamp_does_not_raise(self, config, monkeypatch):
        """
        Best-effort by necessity. A failed write leaves no stamp, and no stamp
        means "leave alone" — so it degrades into doing nothing, not into a loop.
        """

        def boom(*_a, **_k):
            raise OSError("read-only file system")

        monkeypatch.setattr("pathlib.Path.write_text", boom)

        AssetHandler.stamp_client("v2026.8.2")  # must not raise

        assert AssetHandler.client_is_stale() is False


class TestConvergence:
    def test_a_fallback_download_is_not_retried_every_start(self, config):
        """
        ⚠️ The stamp records what was REQUESTED, not what arrived. A release whose
        client cannot be fetched — draft, rate limited, offline — is attempted
        once per version rather than once per restart. GitHub allows 60
        anonymous requests an hour; a container restart loop spends that in a
        minute.
        """
        _tmp, _client, set_version = config
        set_version("2026.8.3")

        AssetHandler.stamp_client("v2026.8.1")  # asked for 8.3, got 8.1

        assert AssetHandler.client_is_stale() is False

    def test_a_failed_install_still_stops_the_retry(self, config):
        _tmp, _client, set_version = config
        set_version("2026.8.3")

        AssetHandler.stamp_client(None)  # nothing could be installed

        assert AssetHandler.client_is_stale() is False

    def test_the_next_version_tries_again(self, config):
        """Converging must not mean giving up for ever."""
        _tmp, _client, set_version = config
        set_version("2026.8.3")
        AssetHandler.stamp_client(None)

        set_version("2026.8.4")

        assert AssetHandler.client_is_stale() is True


def test_the_stamp_sits_beside_the_client_not_inside_it(config):
    """
    Everything inside the client directory is served to anyone who can reach the
    port, so a stamp in there is version disclosure for free.
    """
    tmp, client, _set = config

    AssetHandler.stamp_client("v2026.8.2")

    assert (tmp / AssetHandler.CLIENT_STAMP_NAME).exists()
    assert not (client / AssetHandler.CLIENT_STAMP_NAME).exists()
    assert json.loads((tmp / AssetHandler.CLIENT_STAMP_NAME).read_text())["requested"] == "2026.8.2"


@pytest.fixture()
def bundled(monkeypatch, tmp_path_factory):
    """
    Pretend the installed package carries a `client.zip`, laid out the way the
    Dockerfile and the release workflow build it: ONE top-level `client/` dir.
    Returns a function that (re)writes the bundle with a given index.html body.
    """
    package = tmp_path_factory.mktemp("package")
    monkeypatch.setattr("aivinnet.settings.imres.files", lambda name: package)

    def bundle(index_html: str):
        with zipfile.ZipFile(package / "client.zip", "w") as zf:
            zf.writestr("client/index.html", index_html)
            zf.writestr("client/assets/index.0123abcd.js", "console.log(1)")

    return bundle


class TestBundledClient:
    """
    The Docker image bundles the client built from its own commit. Its version
    says nothing about that client — an image built from master without
    `--build-arg app_version` is `0.0.0` build after build — so a bundle is
    judged by its digest, not by the version.
    """

    def test_extract_lays_the_client_out_where_it_is_served(self, config, bundled):
        tmp, client, _set = config
        bundled("<!doctype html><title>bundled</title>")

        assert AssetHandler.extract_default_client(tmp) is True

        assert "bundled" in (client / "index.html").read_text()
        assert (client / "assets" / "index.0123abcd.js").is_file()

    def test_a_download_era_stamp_is_replaced_by_the_bundle(self, config, bundled):
        """
        ⚠️ The observed case: a master image (0.0.0) had downloaded the latest
        stable release's client and stamped `requested: 0.0.0`. The next master
        image is 0.0.0 as well — by version it looks current, so the old UI
        would stay in the volume for ever.
        """
        tmp, client, set_version = config
        set_version("0.0.0")
        (tmp / AssetHandler.CLIENT_STAMP_NAME).write_text(
            json.dumps({"requested": "0.0.0", "installed": "v2026.9.0"}), encoding="utf-8"
        )
        bundled("<!doctype html><title>from this commit</title>")

        assert AssetHandler.client_is_stale() is True
        AssetHandler.setup_default_client()

        assert "from this commit" in (client / "index.html").read_text()
        assert json.loads((tmp / AssetHandler.CLIENT_STAMP_NAME).read_text())["bundle"]
        assert AssetHandler.client_is_stale() is False

    def test_a_new_bundle_with_the_same_version_replaces_the_old_one(self, config, bundled):
        _tmp, client, set_version = config
        set_version("0.0.0")
        bundled("<!doctype html><title>first build</title>")
        (client / "index.html").unlink()
        AssetHandler.setup_default_client()
        assert "first build" in (client / "index.html").read_text()

        bundled("<!doctype html><title>second build</title>")

        assert AssetHandler.client_is_stale() is True
        AssetHandler.setup_default_client()
        assert "second build" in (client / "index.html").read_text()

    def test_the_same_bundle_is_not_unpacked_again(self, config, bundled):
        bundled("<!doctype html>")
        AssetHandler.stamp_client("2026.8.2")

        assert AssetHandler.client_is_stale() is False

    def test_an_unstamped_client_is_still_left_alone(self, config, bundled):
        """Bundling must not weaken THE rule: unknown provenance means restraint."""
        bundled("<!doctype html>")

        assert AssetHandler.client_is_stale() is False

    def test_a_foreign_client_directory_is_never_judged(self, monkeypatch, tmp_path, bundled):
        paths = Paths()
        monkeypatch.setattr(type(paths), "config_dir", property(lambda self: tmp_path), raising=False)
        monkeypatch.setattr(paths, "client_path", tmp_path / "appimage-client", raising=False)
        bundled("<!doctype html>")

        assert AssetHandler.client_is_stale() is False
