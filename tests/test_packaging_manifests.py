"""Guards for the release packaging.

Each of these has failed silently once, in a way CI could not see:

* The release artifacts install their dependencies from ``uv.lock``, the set
  the tests ran against (``TestLockedReleaseDependencies``). The AppImage used
  a hand-kept ``appimage/requirements.txt`` with open ranges instead, so a
  release could ship whatever PyPI had that day.
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
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


class TestLockedReleaseDependencies:
    """Every release artifact installs exactly what uv.lock pins, with hashes (#300).

    They resolved pyproject's open ranges (`pillow>=11.1.0`) fresh at build
    time: the Docker image via `pip install .`, the binaries via
    `pip install aivinnet[build]`, the AppImage via a hand-kept copy of the
    dependency list. A library release between the last green CI run and a
    release dispatch shipped untested. The lock is exported once per release
    (`build-wheels`) and in the Dockerfile's `lock` stage.
    """

    EXPORT = re.compile(r"uv export --locked --no-dev --no-emit-project")

    def test_the_release_exports_the_lock_once_for_every_binary(self):
        workflow = _release_workflow()
        assert len(self.EXPORT.findall(workflow)) == 2, "runtime and runtime+build, both in build-wheels"
        assert "--extra build -o locked/build.txt" in workflow
        assert 'name: "locked-requirements"' in workflow

    def test_the_binaries_install_only_the_lock(self):
        workflow = _release_workflow()
        assert "--require-hashes -r locked/runtime.txt" in workflow, "AppImage"
        assert "pip install --require-hashes -r locked/build.txt" in workflow, "PyInstaller"
        # The wheel itself never pulls dependencies of its own.
        assert "aivinnet[build]" not in workflow
        # Whole commands: `pip install --target … \` carries `aivinnet` on its
        # continuation line.
        commands = re.sub(r"\\\n\s*", " ", workflow).splitlines()
        for command in commands:
            if not command.strip().startswith("#") and re.search(r"pip install .*\baivinnet\b", command):
                assert "--no-deps" in command, command.strip()

    def test_the_image_installs_only_the_lock(self):
        dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
        assert self.EXPORT.search(dockerfile)
        assert "pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock" in dockerfile
        assert "pip install --no-cache-dir --no-deps ." in dockerfile

    def test_no_unhashed_copy_of_the_dependencies_is_left(self):
        # python-appimage installs an appimage/requirements.txt line by line
        # with `pip install -U`, which checks no hash and upgrades past pins.
        assert not (REPO_ROOT / "appimage" / "requirements.txt").exists()
        # Nothing read the root one any more either; a dead list drifts.
        assert not (REPO_ROOT / "requirements.txt").exists()

    def test_a_stale_lock_stops_the_build(self):
        # `--frozen` exports whatever is committed; `--locked` refuses a lock
        # that no longer matches pyproject.toml (a dependency added without
        # `uv lock` would otherwise ship missing).
        dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
        ci = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        assert "uv export --frozen" not in _release_workflow() + dockerfile
        assert "uv sync --locked" in ci


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
            "Packaging an AppDir that is missing aivinnet, libev or the client "
            "produces an AppImage that only fails at the user's first start."
        )


class TestClientReleaseSource:
    def test_releases_url_points_at_this_fork(self):
        from aivinnet.settings import AssetHandler

        assert "vwellenberg/AivinNet" in AssetHandler.RELEASES_URL, (
            "The client fallback download must use this fork's releases. Pointing it at "
            "swingmx/swingmusic makes installations pull the upstream web client."
        )


def _decode_png_rgba(data: bytes) -> tuple[int, int, bytes]:
    """Minimal stdlib PNG decoder: 8-bit RGBA, non-interlaced — what Pillow writes.

    PIL is mocked away in the fast lane (see `.claude/rules/tests.md`), so the
    icon comparison below cannot lean on it.
    """
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat = 8, b""
    width = height = 0
    while pos < len(data):
        length = int.from_bytes(data[pos : pos + 4], "big")
        kind, body = data[pos + 4 : pos + 8], data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height = int.from_bytes(body[0:4], "big"), int.from_bytes(body[4:8], "big")
            assert body[8:13] == bytes([8, 6, 0, 0, 0]), "expected 8-bit RGBA, non-interlaced"
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length

    raw, stride, bpp = zlib.decompress(idat), width * 4, 4
    out, prev = bytearray(), bytearray(stride)
    for y in range(height):
        ftype, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1 : (y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b, c = prev[i], prev[i - bpp] if i >= bpp else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        out += line
        prev = line
    return width, height, bytes(out)


class TestWindowsExeIcon:
    """The EXE icon is the AivinNet planet, not the swingmusic lamp.

    v2026.8.5 shipped both Windows EXEs with upstream's `logo-fill.light.ico`
    while the AppImage already showed the planet: the PyInstaller spec pointed
    at a file nobody had redrawn. This pins the EXE icon to the same artwork
    as the AppImage icon, pixel for pixel.
    """

    def _spec_icon(self) -> Path:
        spec = (REPO_ROOT / "aivinnet.spec").read_text(encoding="utf-8")
        match = re.search(r"icon=\[pathlib\.Path\('([^']+)'\)\]", spec)
        assert match, "no icon= in aivinnet.spec"
        return REPO_ROOT / match.group(1)

    def test_spec_icon_exists(self):
        assert self._spec_icon().is_file()

    def test_exe_icon_is_the_appimage_artwork(self):
        ico = self._spec_icon().read_bytes()
        count = int.from_bytes(ico[4:6], "little")
        entries = {}
        for i in range(count):
            entry = ico[6 + 16 * i : 22 + 16 * i]
            size = entry[0] or 256
            length, offset = int.from_bytes(entry[8:12], "little"), int.from_bytes(entry[12:16], "little")
            entries[size] = ico[offset : offset + length]

        assert {16, 32, 48, 256} <= entries.keys(), f"missing standard Windows sizes: {sorted(entries)}"

        # The planet is 32x32 pixel art drawn in 10px cells on a 320px canvas,
        # so the 32px entry must equal the AppImage icon sampled at cell centres.
        w, h, icon = _decode_png_rgba(entries[32])
        sw, sh, source = _decode_png_rgba((REPO_ROOT / "appimage" / "aivinnet.png").read_bytes())
        assert (w, h, sw, sh) == (32, 32, 320, 320)
        sampled = b"".join(source[((y * 10 + 5) * 320 + x * 10 + 5) * 4 :][:4] for y in range(32) for x in range(32))
        assert icon == sampled


def test_no_upstream_lamp_logo_is_referenced():
    """The swingmusic lamp logos were deleted; nothing may point at them again."""
    offenders = [
        str(path.relative_to(REPO_ROOT))
        for base in ("src", "client/src", "client/index.html", "client/package.json", "aivinnet.spec")
        for path in ([REPO_ROOT / base] if (REPO_ROOT / base).is_file() else (REPO_ROOT / base).rglob("*"))
        if path.is_file()
        and path.suffix in {".py", ".vue", ".ts", ".html", ".json", ".spec", ".scss"}
        and "logo-fill" in path.read_text(encoding="utf-8", errors="ignore")
    ]
    assert offenders == []


PACKAGE_DIR = REPO_ROOT / "src" / "aivinnet"
VENDORED = PACKAGE_DIR / "lib" / "pydub"


def _package_data_globs() -> list[str]:
    with (REPO_ROOT / "pyproject.toml").open("rb") as file:
        pyproject = tomllib.load(file)

    return pyproject.get("tool", {}).get("setuptools", {}).get("package-data", {}).get("aivinnet", [])


class TestPackageData:
    """
    Every data file in the package must be declared, not left to setuptools-scm.

    scm only adds git-tracked files when `.git` is visible. The Docker build
    copies `src/` without it, so the image came out with no `assets/` — every
    fallback image answered 404 — while the wheel, built from a checkout, was
    complete. Nothing in CI builds the image, so only a declaration check sees it.
    """

    def test_every_data_file_is_declared(self):
        # Expanded the way setuptools does — relative to the package root, `*`
        # not crossing directories. `Path.match` would match from the right and
        # count `plugins/x/assets/icon.png` as covered by `assets/*`.
        declared = {path for pattern in _package_data_globs() for path in PACKAGE_DIR.glob(pattern)}
        undeclared = [
            path.relative_to(PACKAGE_DIR).as_posix()
            for path in PACKAGE_DIR.rglob("*")
            if path.is_file()
            and path.suffix not in {".py", ".pyc"}
            and "__pycache__" not in path.parts
            and VENDORED not in path.parents
            and path not in declared
        ]

        assert not undeclared, (
            f"Not in [tool.setuptools.package-data] aivinnet: {sorted(undeclared)}. "
            "Without it the Docker image (built without .git) ships without these files."
        )

    def test_the_fallback_images_exist(self):
        # The guard above is vacuous if the directory it protects disappears.
        assert (PACKAGE_DIR / "assets" / "default.webp").is_file()


class TestDockerfile:
    def _dockerfile(self) -> str:
        return (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")

    def test_default_config_parent_is_the_config_volume(self):
        # `aivinnet --password-reset` in the container must reach the server's
        # data. The server gets `--config <dir>`; the tool, run bare, falls back
        # to XDG_CONFIG_HOME — which therefore has to be the same directory.
        dockerfile = self._dockerfile()
        entrypoint = re.search(r'"--config",\s*"([^"]+)"', dockerfile)
        xdg = re.search(r"^ENV XDG_CONFIG_HOME=(\S+)$", dockerfile, re.MULTILINE)

        assert entrypoint and xdg, "Dockerfile must pass --config and set XDG_CONFIG_HOME"
        assert xdg.group(1) == entrypoint.group(1)

    def test_the_client_is_built_from_this_checkout_and_bundled(self):
        """
        Without a bundled `client.zip` the server downloads the latest STABLE
        release's client — an image built from master then paired the master
        server with an older UI, and API changes broke it silently.
        """
        dockerfile = self._dockerfile()
        build = re.search(r"^RUN yarn build\b", dockerfile, re.MULTILINE)
        bundle = re.search(r"^COPY --from=\S+ \S*client\.zip \./src/aivinnet/client\.zip$", dockerfile, re.MULTILINE)
        install = re.search(r"pip install --no-cache-dir (--no-deps )?\.", dockerfile)

        assert build, "Dockerfile no longer builds the web client"
        assert bundle, "Dockerfile no longer copies client.zip into src/aivinnet/"
        assert install and bundle.start() < install.start(), "client.zip must be in place before `pip install .`"
        # Only a declared data file reaches the installed package: the build
        # context has no .git, so setuptools-scm cannot add it.
        assert "client.zip" in _package_data_globs()

    def test_the_build_context_has_the_client_source_but_not_its_dependencies(self):
        ignored = {
            line.strip()
            for line in (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        }

        assert not ignored & {"client", "client/", "client/src", "/client"}
        assert "**/node_modules" in ignored

    def test_marks_itself_as_a_container(self):
        from aivinnet.start_info_logger import CONTAINER_ENV

        assert re.search(rf"^ENV {CONTAINER_ENV}=1$", self._dockerfile(), re.MULTILINE)


class TestImageVersion:
    """
    The image's version comes from `--build-arg app_version`, nothing else (#192).

    A build-arg the Dockerfile does not declare is dropped by Docker WITHOUT an
    error, and that is exactly how the release's `app_version` did nothing: the
    image read a `version.txt` relative to the working directory instead. The
    release job overwrote that file just before the build, so published images
    happened to be right — every other build reported the committed copy,
    unbumped since v2026.8.2.
    """

    def _dockerfile(self) -> str:
        return (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")

    def _release_build_args(self) -> set[str]:
        workflow = (REPO_ROOT / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
        block = re.search(r"build-args:\s*\|\n((?:[ \t]+\S.*\n?)+)", workflow)
        assert block, "the release workflow no longer passes build-args — update this test"
        return {line.strip().split("=", 1)[0] for line in block.group(1).splitlines() if line.strip()}

    def test_every_release_build_arg_is_declared(self):
        declared = set(re.findall(r"^ARG\s+(\w+)", self._dockerfile(), re.MULTILINE))
        missing = self._release_build_args() - declared

        assert not missing, (
            f"build.yml passes {sorted(missing)}, the Dockerfile has no ARG for it — Docker drops it silently"
        )

    def test_the_version_arg_reaches_setuptools_scm(self):
        # Scoped to OUR distribution: the unscoped variable would also stamp any
        # dependency that happens to be built from an sdist with setuptools-scm.
        assert re.search(r"SETUPTOOLS_SCM_PRETEND_VERSION_FOR_AIVINNET=\S*app_version", self._dockerfile())

    def test_no_second_version_source(self):
        # One source of truth. A copied version file drifts (it did, by three
        # releases) and was read relative to the CWD.
        # Uses, not mentions: a quoted file name (open), a write (`> version.txt`)
        # or a COPY. The comments explaining why it is gone may keep the name.
        use = re.compile(r"""["']version\.txt["']|>\s*version\.txt|^COPY\b.*version\.txt""", re.MULTILINE)

        assert not (REPO_ROOT / "version.txt").exists()
        for rel in (
            "Dockerfile",
            ".github/workflows/build.yml",
            "src/aivinnet/settings.py",
            "src/aivinnet/api/settings.py",
        ):
            assert not use.search((REPO_ROOT / rel).read_text(encoding="utf-8")), rel


WORKFLOWS = REPO_ROOT / ".github" / "workflows"

# The only write access any workflow may hold, per job (#300). Everything else
# inherits the workflow-level `contents: read`.
ALLOWED_WRITES = {
    ("build.yml", "upload-builds"): {"contents"},  # creates the release
    ("build.yml", "docker"): {"packages"},  # pushes the image to ghcr
}


def _permission_grants(text: str) -> dict[str | None, dict[str, str]]:
    """`permissions:` per scope: None for the workflow level, else the job id.

    A plain line scan: the fast lane has no YAML parser, and both workflows
    keep the usual layout (jobs at two spaces). `write-all`/`read-all` come
    back as {"*": "write"/"read"}.
    """
    grants: dict[str | None, dict[str, str]] = {}
    in_jobs = False
    job: str | None = None
    block_indent: int | None = None
    scope: dict[str, str] | None = None

    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())

        if block_indent is not None:
            if indent > block_indent and scope is not None:
                key, _, value = line.strip().partition(":")
                scope[key.strip()] = value.split("#")[0].strip()
                continue
            block_indent = None

        if indent == 0:
            in_jobs = line.startswith("jobs:")
            job = None
        elif in_jobs and indent == 2 and re.match(r"^  [\w-]+:\s*$", line):
            job = line.strip().rstrip(":")

        found = re.match(r"^(\s*)permissions:\s*([\w-]*)", line)
        if found:
            scope = grants.setdefault(job if in_jobs else None, {})
            inline = found.group(2)
            if inline:
                scope["*"] = inline.removesuffix("-all")
            else:
                block_indent = len(found.group(1))

    return grants


class TestWorkflowPermissions:
    """Least privilege for the workflows (#300).

    Without a `permissions:` key, GITHUB_TOKEN gets the repository default,
    which can be write access to everything. A compromised action or a
    poisoned tool download in any job (the release builds run third-party
    actions and fetch appimagetool) could then rewrite code or releases.
    So: `contents: read` for the whole workflow, write only where a job needs it.
    """

    def _workflows(self):
        files = sorted(WORKFLOWS.glob("*.yml"))
        assert files, "no workflows found — update this test"
        return [(f.name, f.read_text(encoding="utf-8")) for f in files]

    def test_every_workflow_defaults_to_read_only(self):
        for name, text in self._workflows():
            top = _permission_grants(text).get(None)
            assert top, f"{name}: no workflow-level `permissions:` — every job gets the repository default"
            assert top.get("contents") == "read", f"{name}: {top}"
            assert set(top.values()) <= {"read", "none"}, f"{name}: workflow-level write access {top}"

    def test_write_access_only_where_a_job_needs_it(self):
        for name, text in self._workflows():
            for job, scope in _permission_grants(text).items():
                if job is None:
                    continue
                writes = {key for key, value in scope.items() if value == "write"}
                allowed = ALLOWED_WRITES.get((name, job), set())
                assert writes <= allowed, f"{name}: job `{job}` writes {sorted(writes - allowed)}"

    def test_the_grant_scan_sees_job_blocks(self):
        # Guards the scanner itself: if it stopped finding the release job's
        # block, the test above would pass for any workflow.
        grants = _permission_grants(_release_workflow())
        assert grants.get("upload-builds") == {"contents": "write"}
        assert grants.get("docker") == {"contents": "read", "packages": "write"}


def test_the_release_can_be_dispatched_again_for_its_tag():
    """`git tag v<x>` fails when the tag exists — and after a published release it does (#300).

    `fetch-depth: 0` brings the release's tag along, so re-running the workflow
    for the same version (say, after a failed Docker push) stopped in
    build-wheels before anything was rebuilt. The tag is local only, read by
    setuptools-scm for the version; `-f` moves it to the commit being built.
    """
    tags = re.findall(r"^\s*git tag\b.*$", _release_workflow(), re.MULTILINE)
    assert tags, "build-wheels no longer tags — update this test"
    for line in tags:
        assert re.search(r"git tag\s+(-f|--force)\b", line), line.strip()


class TestPinnedBuildInputs:
    """Nothing a workflow runs may change under it (#300).

    A tag like `ncipollo/release-action@v1` is a pointer that whoever controls
    that repository can move to other code, and the release jobs run it with
    write access to releases and images. The same holds for the AppImage
    tools: they build what `install.sh` hands to every user. Dependabot
    (`.github/dependabot.yml`) brings the updates as PRs instead.
    """

    PINNED = re.compile(r"^\S+@[0-9a-f]{40} # v\d+(\.\d+)*$")

    def _uses(self):
        for workflow in sorted(WORKFLOWS.glob("*.yml")):
            for line in workflow.read_text(encoding="utf-8").splitlines():
                found = re.match(r"^\s*(?:- )?uses: (.+)$", line)
                if found:
                    yield workflow.name, found.group(1).strip()

    def test_every_action_is_pinned_to_a_commit(self):
        uses = list(self._uses())
        assert uses, "no `uses:` found — update this test"
        loose = [f"{name}: {ref}" for name, ref in uses if not self.PINNED.match(ref)]
        assert not loose, f"pin these to a full commit SHA with a `# vX.Y.Z` comment: {loose}"

    def test_the_appimage_tools_are_pinned(self):
        workflow = _release_workflow()
        assert re.search(r'pip install "python-appimage==[\d.]+"', workflow)
        assert "appimagetool-$APPIMAGE_ARCH.AppImage" in workflow
        assert re.search(r"sha256sum -c -", workflow), "appimagetool must be checked against its checksum"

    def test_dependabot_keeps_the_pins_fresh(self):
        config = (REPO_ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
        assert "package-ecosystem: github-actions" in config
