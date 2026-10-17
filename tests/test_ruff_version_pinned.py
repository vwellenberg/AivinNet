"""Every ruff the project runs is the same ruff.

Pre-commit pinned v0.11.4 while CI ran `uvx ruff`, i.e. whatever was newest
that day (0.17.1 when this was written). Two formatters can disagree, and then
a commit that pre-commit just reformatted fails CI's `ruff format --check`, or
the other way round. The version now has one source, the `rev:` of the ruff
hook in `.pre-commit-config.yaml` (what `pre-commit autoupdate` bumps), and
every `uvx ruff` call carries the same version as `ruff@X`.
"""

import re
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


def test_every_uvx_ruff_call_uses_the_pre_commit_version():
    version = _pinned_version()
    calls = list(_calls())
    off = [f"{name}: ruff@{found}" for name, found in calls if found != version]
    assert not off, f"pin these to ruff@{version} (the rev in .pre-commit-config.yaml): {off}"


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
