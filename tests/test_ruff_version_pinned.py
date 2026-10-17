"""Every ruff the project runs is the same ruff.

Pre-commit pinned v0.11.4 while CI ran `uvx ruff`, i.e. whatever was newest
that day (0.17.1 when this was written). Two formatters can disagree, and then
a commit that pre-commit just reformatted fails CI's `ruff format --check`, or
the other way round. The version now has one source, the `rev:` of the ruff
hook in `.pre-commit-config.yaml` (what `pre-commit autoupdate` bumps), and
every `uvx ruff` call carries the same version as `ruff@X`.

uv was a third source: the dev group listed a bare `ruff`, which uv.lock
resolved to 0.16.9, so `uv sync` + `uv run ruff` formatted with another ruff
again. Nothing called it that way, so the group dropped it; whoever adds it
back pins it to the rev.
"""

import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# The places that call ruff through uvx. The hook in settings.json spells the
# executable `"$HOME/.local/bin/uvx.exe"`, JSON-escaped.
CALLERS = [
    ".github/workflows/ci.yml",
    ".claude/settings.json",
    "CLAUDE.md",
    "README.md",
]

UVX_RUFF = re.compile(r'uvx(?:\.exe\\?")? ruff(?:@(\S+))?(?=\s)')


def _pinned_version() -> str:
    config = (REPO_ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    found = re.search(r"repo: https://github\.com/astral-sh/ruff-pre-commit\s+rev: v(\S+)", config)
    assert found, "ruff hook or its rev not found in .pre-commit-config.yaml — update this test"
    return found.group(1)


def _calls():
    for name in CALLERS:
        text = (REPO_ROOT / name).read_text(encoding="utf-8")
        for match in UVX_RUFF.finditer(text):
            yield name, match.group(1)


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


def test_every_uvx_ruff_call_uses_the_pre_commit_version():
    version = _pinned_version()
    calls = list(_calls())
    off = [f"{name}: ruff@{found}" for name, found in calls if found != version]
    assert not off, f"pin these to ruff@{version} (the rev in .pre-commit-config.yaml): {off}"


def test_uv_installs_no_other_ruff():
    # A bare `ruff` passes as long as uv.lock happens to match, and drifts on
    # the next `uv lock --upgrade`; so the requirement itself must be pinned.
    version = _pinned_version()
    off = [f"pyproject.toml: {req}" for req in _uv_requirements("ruff") if req != f"ruff=={version}"]
    off += [f"uv.lock: ruff {found}" for found in _locked_versions("ruff") if found != version]
    assert not off, f"pin these to ruff=={version} (the rev in .pre-commit-config.yaml) or drop them: {off}"


def test_pre_commit_checks_what_ci_checks():
    # CI runs `ruff check src/ tests/` and `ruff format --check src/ tests/`.
    # Without `files`, the hooks took every tracked file: run.py, and (since
    # ruff-format learned Markdown) the code examples in the docs.
    config = (REPO_ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    ruff_repo = config.split("repo: https://github.com/astral-sh/ruff-pre-commit")[1].split("- repo:")[0]
    hooks = re.findall(r"- id: (\S+)\n((?:\s{8,}.+\n)*)", ruff_repo)
    assert {hook for hook, _ in hooks} == {"ruff-check", "ruff-format"}, hooks
    unscoped = [hook for hook, body in hooks if "files: ^(src|tests)/" not in body]
    assert not unscoped, f"scope these hooks to CI's paths with `files: ^(src|tests)/`: {unscoped}"
    ci = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert re.search(r"ruff@\S+ check src/ tests/\n", ci)
    assert re.search(r"ruff@\S+ format --check src/ tests/\n", ci)


def test_each_caller_still_calls_ruff():
    # Without this, moving or renaming a call would let the test above pass on
    # an empty list.
    callers = {name for name, _ in _calls()}
    assert callers == set(CALLERS), f"no `uvx ruff` found in {set(CALLERS) - callers} — update CALLERS"
