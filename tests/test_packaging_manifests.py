"""Guards for the release packaging manifests.

These are hand-maintained duplicates of information that lives elsewhere, and
both have failed silently in a way CI could not see:

* ``appimage/requirements.txt`` is a second copy of the runtime dependencies.
  The AppImage installs ``swingmusic`` with ``--no-deps``, so a dependency that
  exists only in ``pyproject.toml`` is missing from the AppImage and blows up
  as an ImportError at start — long after a green CI run.
* ``settings.py::AssetHandler.RELEASES_URL`` decides whose web client an
  installation downloads when no ``client.zip`` is bundled. Pointing at the
  upstream repo silently ships the upstream UI, and an upstream merge would
  reintroduce that value without any test noticing.
"""

import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Dependencies whose environment marker excludes Linux are legitimately absent
# from the (Linux-only) AppImage requirements file.
WINDOWS_ONLY_MARKER = re.compile(r"sys_platform\s*==\s*['\"]win32['\"]")


def _canonical(name: str) -> str:
    """PEP 503 normalisation, so `colorgram.py` == `colorgram-py`."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_name(spec: str) -> str:
    return _canonical(re.split(r"[><=!~\[;\s]", spec.strip(), maxsplit=1)[0])


def _pyproject_runtime_deps() -> set[str]:
    with (REPO_ROOT / "pyproject.toml").open("rb") as file:
        pyproject = tomllib.load(file)

    return {
        _requirement_name(dep) for dep in pyproject["project"]["dependencies"] if not WINDOWS_ONLY_MARKER.search(dep)
    }


def _appimage_deps() -> set[str]:
    lines = (REPO_ROOT / "appimage" / "requirements.txt").read_text(encoding="utf-8").splitlines()
    return {_requirement_name(line) for line in lines if line.strip() and not line.strip().startswith("#")}


class TestAppimageRequirements:
    def test_no_runtime_dependency_is_missing(self):
        missing = _pyproject_runtime_deps() - _appimage_deps()
        assert not missing, (
            f"Dependencies missing from appimage/requirements.txt: {sorted(missing)}. "
            "The AppImage installs swingmusic with --no-deps, so these would be absent at runtime."
        )

    def test_no_stale_extra_dependency(self):
        extra = _appimage_deps() - _pyproject_runtime_deps()
        assert not extra, (
            f"appimage/requirements.txt lists dependencies that pyproject.toml no longer has: {sorted(extra)}"
        )


class TestClientReleaseSource:
    def test_releases_url_points_at_this_fork(self):
        from swingmusic.settings import AssetHandler

        assert "vwellenberg/AivinNet" in AssetHandler.RELEASES_URL, (
            "The client fallback download must use this fork's releases. Pointing it at "
            "swingmx/swingmusic makes installations pull the upstream web client."
        )
