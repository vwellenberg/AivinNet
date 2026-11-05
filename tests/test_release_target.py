"""`scripts/release-target.sh` — which commit the release upload sends (AivinNet#710).

The upload sent `commit: ${{ github.sha }}` on every run, and the release action
passes it as `target_commitish` on update, too. GitHub refuses that for
GITHUB_TOKEN with 403 as soon as master's workflows differ from the commit
being built (measured with a probe workflow on 2026-11-05: same token, a commit
with master's workflows 201, one with older workflows 403). Re-running the
upload of v2026.11.2-rc1 after #720 failed exactly so.

`gh` is a stub that prints the listing the real call would return.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "release-target.sh"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "build.yml"

# The path the check found, not the bare name (see test_prune_serve_assets.py).
BASH = shutil.which("bash")

SHA = "8d09a477281e035f8c93d3b8bb22cf32a09131ac"
OTHER = "96f84ccd6e819fdc5167305f4aad103eba9e0bd4"

STUB = r"""#!/usr/bin/env bash
# gh api repos/<repo>/releases --paginate --jq ...      -> $STUB_RELEASES (tag<TAB>target lines)
# gh api repos/<repo>/git/matching-refs/tags/<t> ...  -> refs of $STUB_TAGS starting with <t>
# gh api repos/<repo>/commits/<tag> --jq .sha           -> sha from $STUB_TAGS
# $STUB_FAIL names a call kind (releases, refs, commits) that answers 502.
echo "$*" >> "$STUB_LOG"
case "$2" in
  */releases) kind=releases ;;
  */git/matching-refs/tags/*) kind=refs ;;
  */commits/*) kind=commits ;;
  *) exit 2 ;;
esac
if [ "$kind" = "${STUB_FAIL:-}" ]; then echo "stub: $kind answered 502" >&2; exit 1; fi
name=${2##*/}
case "$kind" in
  releases) printf '%b' "$STUB_RELEASES" ;;
  refs) printf '%b' "$STUB_TAGS" | awk -v t="$name" 'index($1, t) == 1 { print "refs/tags/" $1 }' ;;
  commits)
    sha=$(printf '%b' "$STUB_TAGS" | awk -v t="$name" '$1 == t { print $2 }')
    [ -n "$sha" ] || { echo '{"message":"No commit found"}' >&2; exit 1; }
    echo "$sha" ;;
esac
"""


def run(tmp_path: Path, releases: str = "", tags: str = "", fail: str = "") -> subprocess.CompletedProcess:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    gh = bin_dir / "gh"
    gh.write_text(STUB, newline="\n")
    gh.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "STUB_RELEASES": releases,
        "STUB_TAGS": tags,
        "STUB_FAIL": fail,
        "STUB_LOG": str(tmp_path / "gh.log"),
    }
    return subprocess.run(
        [BASH, str(SCRIPT), "vwellenberg/AivinNet", "v2026.11.2-rc1", SHA],
        env=env,
        capture_output=True,
        text=True,
    )


needs_bash = pytest.mark.skipif(BASH is None, reason="needs bash (the CI lane has it)")


@needs_bash
class TestReleaseTarget:
    def test_a_new_release_gets_the_commit_being_built(self, tmp_path):
        result = run(tmp_path, releases="v2026.11.1\t9900d16b\n")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == SHA

    def test_a_draft_for_this_commit_gets_no_target(self, tmp_path):
        """The regression: the re-run upload of v2026.11.2-rc1 resent the target and got 403."""
        result = run(tmp_path, releases=f"v2026.11.1\t9900d16b\nv2026.11.2-rc1\t{SHA}\n")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == ""

    def test_a_published_release_is_judged_by_its_tag(self, tmp_path):
        # target_commitish can name a branch; the tag is the commit that shipped.
        result = run(tmp_path, releases="v2026.11.2-rc1\tmaster\n", tags=f"v2026.11.2-rc1 {SHA}\n")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == ""

    def test_a_draft_for_another_commit_stops_the_run(self, tmp_path):
        result = run(tmp_path, releases=f"v2026.11.2-rc1\t{OTHER}\n")
        assert result.returncode == 1
        assert result.stdout.strip() == ""
        assert "::error" in result.stderr and OTHER in result.stderr and SHA in result.stderr

    def test_a_tag_on_another_commit_stops_the_run(self, tmp_path):
        # A re-run dispatched from master instead of from the tag (packaging-release.md).
        result = run(tmp_path, releases=f"v2026.11.2-rc1\t{SHA}\n", tags=f"v2026.11.2-rc1 {OTHER}\n")
        assert result.returncode == 1
        assert "Use workflow from" in result.stderr

    def test_two_releases_with_the_tag_stop_the_run(self, tmp_path):
        result = run(tmp_path, releases=f"v2026.11.2-rc1\t{SHA}\nv2026.11.2-rc1\t{SHA}\n")
        assert result.returncode == 1
        assert "Several releases" in result.stderr

    def test_a_similar_tag_is_not_this_release(self, tmp_path):
        # rc10 must not count as rc1: the match is on the whole tag.
        result = run(tmp_path, releases=f"v2026.11.2-rc10\t{OTHER}\nv2026.11.2\t{OTHER}\n")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == SHA

    @pytest.mark.parametrize("fail", ["releases", "refs", "commits"])
    def test_a_failing_api_call_fails_the_run(self, tmp_path, fail):
        # Not "no release" or "no tag": either would hand the action a target
        # it must not send, or compare against the wrong commit.
        result = run(tmp_path, releases=f"v2026.11.2-rc1\t{SHA}\n", tags=f"v2026.11.2-rc1 {SHA}\n", fail=fail)
        assert result.returncode != 0
        assert result.stdout.strip() == ""
        assert f"stub: {fail} answered 502" in result.stderr

    def test_a_tag_that_only_starts_with_this_one_is_not_it(self, tmp_path):
        # matching-refs is a prefix search: v2026.11.2-rc10 must not count.
        result = run(tmp_path, releases=f"v2026.11.2-rc1\t{SHA}\n", tags=f"v2026.11.2-rc10 {OTHER}\n")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == ""


def _upload_step() -> str:
    text = WORKFLOW.read_text(encoding="utf-8")
    start = text.index("uses: ncipollo/release-action@")
    end = text.find("\n      - ", start)
    return text[start : end if end != -1 else len(text)]


class TestUploadStep:
    def test_the_action_gets_the_chosen_target_not_the_run_sha(self):
        commit = re.search(r"^\s*commit:\s*(.+)$", _upload_step(), re.MULTILINE)
        assert commit, "the release action no longer gets a commit — update this test"
        assert commit.group(1).strip() == "${{ steps.target.outputs.commit }}"

    def test_the_target_step_runs_the_script_and_has_it_checked_out(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        job = text[text.index("\n  upload-builds:") :]
        # Up to the next job, or the end of the file.
        nxt = re.search(r"\n  [a-z][\w-]*:\n", job[1:])
        job = job[: nxt.start() + 1] if nxt else job
        assert "id: target" in job
        assert "bash scripts/release-target.sh" in job
        # The job checks out sparsely; a script it does not list is not there.
        sparse = re.search(r"sparse-checkout: \|\n((?:\s{12}\S.*\n)+)", job)
        assert sparse and "scripts/release-target.sh" in sparse.group(1)
        assert job.index("id: target") < job.index("uses: ncipollo/release-action@")
