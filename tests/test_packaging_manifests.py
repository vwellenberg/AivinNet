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
* The release workflow's AppDir path is *discovered*, not spelled out.
  python-appimage names the directory after ``Name=`` in the desktop file, so
  any literal path there is a guess that was already wrong once — see
  ``TestAppimageWorkflow``.
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


def _release_workflow() -> str:
    return (REPO_ROOT / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")


class TestAppimageWorkflow:
    """The AppDir path must come from discovery, never from a literal.

    python-appimage derives the directory name from `Name=` in
    appimage/aivinnet.desktop (`AivinNet-x86_64`), NOT from its own `-n` flag
    (`aivinnet-x86_64`). The workflow used to spell out the lower-case name for
    every step after the build, which made `pip install --target` create a
    second, empty directory; appimagetool then got that one and aborted with
    "Desktop file not found" while the real AppDir sat unused next to it. Since
    the coupling is invisible — renaming the app in a desktop file breaks a
    workflow three files away — a test has to hold it.
    """

    APPDIR_LITERAL = re.compile(r"aivinnet-\$APPIMAGE_ARCH")

    def test_appdir_is_discovered_by_looking_for_apprun(self):
        workflow = _release_workflow()
        assert "AppRun" in workflow and "APPDIR=" in workflow, (
            "The AppImage job must locate its AppDir by finding the directory that "
            "contains AppRun and export it as $APPDIR."
        )

    def test_no_step_spells_out_the_appdir_path(self):
        offenders = [
            line.strip()
            for line in _release_workflow().splitlines()
            # `-n aivinnet-<arch>` is the application NAME and legitimate; the
            # packaged file is `aivinnet-v<tag>-<arch>.AppImage`, also fine.
            if self.APPDIR_LITERAL.search(line) and " -n " not in line and ".AppImage" not in line
        ]
        assert not offenders, (
            "These lines use a hard-coded AppDir path instead of $APPDIR: "
            f"{offenders}. python-appimage names the AppDir after the desktop "
            "file's Name=, so the literal is a guess — and it was wrong."
        )

    def test_the_assembled_appdir_is_verified_before_packaging(self):
        workflow = _release_workflow()
        assert "Verify the AppDir is complete" in workflow, (
            "Packaging an AppDir that is missing swingmusic, libev or the client "
            "produces an AppImage that only fails at the user's first start."
        )


class TestClientReleaseSource:
    def test_releases_url_points_at_this_fork(self):
        from swingmusic.settings import AssetHandler

        assert "vwellenberg/AivinNet" in AssetHandler.RELEASES_URL, (
            "The client fallback download must use this fork's releases. Pointing it at "
            "swingmx/swingmusic makes installations pull the upstream web client."
        )
