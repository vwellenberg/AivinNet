"""`scripts/prune-releases.sh` — a release replaces the ones before it.

The user's rule since 2026-11-07: every published "latest" release removes the
older releases (their pages and files), the git tags stay. The Release workflow
runs the script after the upload; Actions → Prune releases runs it by hand.

`gh` is a stub: `gh api --paginate .../releases` prints $STUB_RELEASES (the
id<TAB>tag<TAB>draft<TAB>published_at lines the real --jq would give), every
`gh api -X DELETE ...` is logged.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "prune-releases.sh"
BUILD = REPO_ROOT / ".github" / "workflows" / "build.yml"
BUTTON = REPO_ROOT / ".github" / "workflows" / "prune-releases.yml"

# The path the check found, not the bare name (see test_prune_serve_assets.py).
BASH = shutil.which("bash")

STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [ "$1 $2" = "api --paginate" ]; then printf '%b' "$STUB_RELEASES"; fi
"""

RELEASES = (
    "1\\tv2026.10.6\\tfalse\\t2026-10-29T00:27:30Z\\n"
    "2\\tv2026.11.2-rc1\\ttrue\\t\\n"
    "3\\tv2026.11.4\\tfalse\\t2026-11-07T11:30:00Z\\n"
    "4\\tv2026.11.3\\tfalse\\t2026-11-06T18:10:03Z\\n"
)


def run(tmp_path, keep="1", dry_run="false", releases=RELEASES):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    gh = bindir / "gh"
    gh.write_text(STUB)
    gh.chmod(0o755)
    log = tmp_path / "gh.log"
    log.write_text("")
    env = {**os.environ, "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}"}
    env.update(STUB_LOG=str(log), STUB_RELEASES=releases)
    result = subprocess.run(
        [BASH, str(SCRIPT), "vwellenberg/AivinNet", keep, dry_run],
        capture_output=True,
        text=True,
        env=env,
    )
    deleted = [line.split("/")[-1] for line in log.read_text().splitlines() if "-X DELETE" in line]
    return result, deleted


pytestmark = pytest.mark.skipif(BASH is None or os.name == "nt", reason="needs bash with a POSIX PATH")


def test_keeps_the_newest_published_release_and_removes_the_rest(tmp_path):
    result, deleted = run(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "keep    v2026.11.4" in result.stdout
    # by id: v2026.11.3, v2026.10.6 and the draft
    assert sorted(deleted) == ["1", "2", "4"]


def test_a_draft_is_never_kept_even_when_it_is_the_newest(tmp_path):
    releases = "9\\tv2026.12.0-rc1\\ttrue\\t\\n3\\tv2026.11.4\\tfalse\\t2026-11-07T11:30:00Z\\n"
    result, deleted = run(tmp_path, releases=releases)
    assert result.returncode == 0, result.stderr
    assert deleted == ["9"]


def test_keep_two(tmp_path):
    _result, deleted = run(tmp_path, keep="2")
    assert sorted(deleted) == ["1", "2"]


def test_dry_run_removes_nothing(tmp_path):
    result, deleted = run(tmp_path, dry_run="true")
    assert result.returncode == 0, result.stderr
    assert deleted == []
    assert "would remove v2026.11.3" in result.stdout


@pytest.mark.parametrize("keep", ["0", "-1", "one", ""])
def test_keep_must_be_at_least_one(tmp_path, keep):
    result, deleted = run(tmp_path, keep=keep)
    assert result.returncode != 0
    assert deleted == []


def test_no_releases_is_not_an_error(tmp_path):
    result, deleted = run(tmp_path, releases="")
    assert result.returncode == 0, result.stderr
    assert deleted == []


def test_release_workflow_prunes_only_after_a_published_latest_release():
    text = BUILD.read_text(encoding="utf-8")
    step = text[text.index("- name: Remove older releases") :]
    step = step[: step.index("\n\n")] if "\n\n" in step else step
    assert "github.event.inputs.is_draft == 'false'" in step
    assert "github.event.inputs.is_latest == 'true'" in step
    assert 'bash scripts/prune-releases.sh "${{ github.repository }}" 1 false' in step
    # after the upload, in the same job (the one holding contents: write)
    assert text.index("- name: Upload artifacts to GitHub Release") < text.index("- name: Remove older releases")


def test_the_button_runs_the_same_script():
    assert 'bash scripts/prune-releases.sh "$REPO" "$KEEP" "$DRY_RUN"' in BUTTON.read_text(encoding="utf-8")
