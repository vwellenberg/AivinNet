"""Every mypy the project runs is the same mypy, on the same files.

Pre-commit pinned mirrors-mypy v1.15.0 while CI ran `uvx … mypy`, i.e. whatever
was newest that day (2.4.0 when this was written). A new mypy release could then
turn master red with no code change, or reject in CI what pre-commit just passed.
As for ruff (test_ruff_version_pinned.py), the version has one source, the `rev:`
of the mypy hook in `.pre-commit-config.yaml` (what `pre-commit autoupdate`
bumps), and every `uvx` call carries the same version as `mypy@X`.

The checked files drifted the same way: the command in CLAUDE.md still listed
six of the eight modules CI and pre-commit check.

uv was a third source: the dev group listed a bare `mypy`, which uv.lock
resolved to 2.3.1, so `uv sync` + `uv run mypy` checked with another mypy.
Nothing called it that way, so the group dropped it; whoever adds it back pins
it to the rev.
"""

import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MYPY_HOOK = "repo: https://github.com/pre-commit/mirrors-mypy"

# The places that call mypy through uvx.
CALLERS = [
    ".github/workflows/ci.yml",
    "CLAUDE.md",
]

# `uvx --with xxhash … mypy@X <files> --config-file …`: the `--with` extras come
# before the tool, the checked files after it.
UVX_MYPY = re.compile(r"uvx(?: --with \S+)* mypy(?:@(\S+))?\s(.*?)--config-file", re.S)
MODULE = re.compile(r"src/aivinnet/\S+?\.py")


def _pre_commit_hook() -> str:
    config = (REPO_ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert MYPY_HOOK in config, "mypy hook not found in .pre-commit-config.yaml — update this test"
    return config.split(MYPY_HOOK)[1].split("- repo:")[0]


def _pinned_version() -> str:
    found = re.match(r"\s+rev: v(\S+)", _pre_commit_hook())
    assert found, "rev of the mypy hook not found in .pre-commit-config.yaml — update this test"
    return found.group(1)


def _calls():
    for name in CALLERS:
        text = (REPO_ROOT / name).read_text(encoding="utf-8")
        for match in UVX_MYPY.finditer(text):
            yield name, match.group(1), set(MODULE.findall(match.group(2)))


def _uv_requirements(tool: str) -> list[str]:
    # Everything `uv sync` can be told to install: dependencies, extras, the
    # dependency groups and uv's older `dev-dependencies`.
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project = pyproject.get("project", {})
    lists = [
        project.get("dependencies", []),
        *project.get("optional-dependencies", {}).values(),
        *pyproject.get("dependency-groups", {}).values(),
        pyproject.get("tool", {}).get("uv", {}).get("dev-dependencies", []),
    ]
    named = re.compile(rf"{tool}(?![\w.-])", re.I)
    return [req.replace(" ", "") for reqs in lists for req in reqs if isinstance(req, str) and named.match(req)]


def _locked_versions(tool: str) -> list[str]:
    lock = tomllib.loads((REPO_ROOT / "uv.lock").read_text(encoding="utf-8"))
    return [package["version"] for package in lock["package"] if package["name"] == tool]


def test_every_uvx_mypy_call_uses_the_pre_commit_version():
    version = _pinned_version()
    off = [f"{name}: mypy@{found}" for name, found, _ in _calls() if found != version]
    assert not off, f"pin these to mypy@{version} (the rev in .pre-commit-config.yaml): {off}"


def test_uv_installs_no_other_mypy():
    # A bare `mypy` passes as long as uv.lock happens to match, and drifts on
    # the next `uv lock --upgrade`; so the requirement itself must be pinned.
    version = _pinned_version()
    off = [f"pyproject.toml: {req}" for req in _uv_requirements("mypy") if req != f"mypy=={version}"]
    off += [f"uv.lock: mypy {found}" for found in _locked_versions("mypy") if found != version]
    assert not off, f"pin these to mypy=={version} (the rev in .pre-commit-config.yaml) or drop them: {off}"


def test_every_mypy_checks_the_same_modules():
    hook = set(MODULE.findall(_pre_commit_hook()))
    assert hook, "no modules found in the mypy hook's args — update this test"
    off = {name: sorted(hook ^ modules) for name, _, modules in _calls() if modules != hook}
    assert not off, f"these differ from the mypy hook's args in .pre-commit-config.yaml: {off}"


def test_each_caller_still_calls_mypy():
    # Without this, moving or renaming a call would let the tests above pass on
    # an empty list.
    callers = {name for name, _, _ in _calls()}
    assert callers == set(CALLERS), f"no `uvx … mypy` found in {set(CALLERS) - callers} — update CALLERS"
