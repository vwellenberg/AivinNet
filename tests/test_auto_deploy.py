"""`scripts/auto-deploy.sh` — the server half of the deploy button (AivinNet#478).

The script runs unattended every minute on the box that serves the app, so the
failure modes worth pinning are the quiet ones: a restart that does not happen
after a backend change (the old process keeps running, the deploy says
DEPLOYED — client/CLAUDE.md has the story), a deploy that loops every minute,
a ref that names a commit master does not contain, and a checkout with
someone's local work in it.

Real git against a local bare "origin"; the build, restart and health steps are
stubs that write to a log, so the test sees which ones ran.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "auto-deploy.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("git") is None or shutil.which("flock") is None,
    reason="needs bash, git and flock (the CI lane has them)",
)

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}


def git(cwd: Path, *args: str) -> str:
    env = {**os.environ, **GIT_ENV}
    return subprocess.run(["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout.strip()


class Box:
    """An origin, a developer clone that pushes, and the server's checkout."""

    def __init__(self, root: Path):
        self.origin = root / "origin.git"
        self.dev = root / "dev"
        self.server = root / "server"
        self.state = root / "state"
        self.log = root / "steps.log"

        subprocess.run(["git", "init", "-q", "--bare", "-b", "master", str(self.origin)], check=True)
        subprocess.run(["git", "init", "-q", "-b", "master", str(self.dev)], check=True)
        git(self.dev, "remote", "add", "origin", str(self.origin))
        self.commit("README.md", "one")
        subprocess.run(
            ["git", "clone", "-q", str(self.origin), str(self.server)], check=True, env={**os.environ, **GIT_ENV}
        )

    def commit(self, path: str, content: str) -> str:
        target = self.dev / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        git(self.dev, "add", "-A")
        git(self.dev, "commit", "-q", "-m", f"change {path}")
        git(self.dev, "push", "-q", "origin", "master")
        return git(self.dev, "rev-parse", "HEAD")

    def signal(self, sha: str, name: str = "x") -> str:
        """What the workflow does: a new commit with `sha` as parent, on `deploy`."""
        tree = git(self.dev, "rev-parse", f"{sha}^{{tree}}")
        signal = git(self.dev, "commit-tree", tree, "-p", sha, "-m", f"deploy {sha} ({name})")
        git(self.dev, "push", "-q", "-f", "origin", f"{signal}:refs/heads/deploy")
        return signal

    def run(self, **env: str) -> subprocess.CompletedProcess:
        log = self.log
        stubs = {
            "REPO": str(self.server),
            "STATE": str(self.state),
            "GIT_FETCH_FLAGS": "",
            "CLIENT_INSTALL": f"echo client-install >> {log}",
            "CLIENT_DEPLOY": f"echo client >> {log}",
            "BACKEND_SYNC": f"echo backend-sync >> {log}",
            "RESTART": f"echo restart >> {log}",
            "HEALTH": "true",
            "VERIFY": "0",
        }
        return subprocess.run(
            ["bash", str(SCRIPT)],
            env={**os.environ, **GIT_ENV, **stubs, **env},
            capture_output=True,
            text=True,
        )

    def steps(self) -> list[str]:
        return self.log.read_text().split() if self.log.exists() else []

    def head(self) -> str:
        return git(self.server, "rev-parse", "HEAD")


@pytest.fixture()
def box(tmp_path):
    return Box(tmp_path)


def plan(box: Box, from_sha: str, to_sha: str) -> list[str]:
    result = subprocess.run(
        ["bash", str(SCRIPT), "--plan", from_sha, to_sha],
        env={**os.environ, **GIT_ENV, "REPO": str(box.dev)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.split()


# ------------------------------------------------------------------ the plan


def test_a_client_change_rebuilds_the_client_and_leaves_the_backend_running(box):
    base = git(box.dev, "rev-parse", "HEAD")
    to = box.commit("client/src/App.vue", "<template/>")
    assert plan(box, base, to) == ["client"]


def test_a_new_client_dependency_installs_before_the_build(box):
    base = git(box.dev, "rev-parse", "HEAD")
    to = box.commit("client/yarn.lock", "# lock")
    assert plan(box, base, to) == ["client-deps", "client"]


def test_a_backend_change_restarts(box):
    base = git(box.dev, "rev-parse", "HEAD")
    to = box.commit("src/aivinnet/app.py", "x = 1")
    assert plan(box, base, to) == ["backend"]


def test_a_new_backend_dependency_syncs_and_restarts(box):
    base = git(box.dev, "rev-parse", "HEAD")
    to = box.commit("uv.lock", "# lock")
    assert plan(box, base, to) == ["backend-deps", "backend"]


def test_docs_and_tests_need_nothing(box):
    base = git(box.dev, "rev-parse", "HEAD")
    box.commit("docs/x.md", "words")
    to = box.commit("tests/test_x.py", "def test(): pass")
    assert plan(box, base, to) == []


def test_nothing_deployed_yet_means_everything(box):
    # A restart costs seconds; a process still running the old code costs a
    # bug report — so an unknown starting point does all of it.
    to = git(box.dev, "rev-parse", "HEAD")
    assert plan(box, "", to) == ["client-deps", "client", "backend-deps", "backend"]


# ------------------------------------------------------------------ a run


def test_no_signal_yet_is_a_quiet_no_op(box):
    result = box.run()
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert box.steps() == []


def test_a_signal_deploys_its_parent_once(box):
    assert box.run().returncode == 0  # no signal yet

    target = box.commit("src/aivinnet/app.py", "x = 2")
    box.signal(target)
    result = box.run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert "DEPLOYED " + target in result.stdout
    assert box.head() == target
    assert (box.state / "deployed").read_text().strip() == target

    # The next minute: same signal, nothing happens.
    box.log.unlink()
    again = box.run()
    assert again.returncode == 0
    assert again.stdout == ""
    assert box.steps() == []


def test_only_the_parts_that_changed_run(box):
    one = box.commit("client/src/a.vue", "a")
    box.signal(one, "first")
    assert box.run().returncode == 0
    box.log.unlink()

    two = box.commit("client/src/b.vue", "b")
    box.signal(two, "second")
    assert box.run().returncode == 0
    assert box.steps() == ["client"]


def test_a_failed_deploy_is_not_retried_every_minute_but_on_the_next_signal(box):
    target = box.commit("src/aivinnet/app.py", "x = 3")
    box.signal(target, "first")

    failing = box.run(RESTART="false")
    assert failing.returncode == 1
    assert "FAILED " + target in failing.stdout
    assert not (box.state / "deployed").exists()

    # A minute later: the same signal is not tried again.
    quiet = box.run(RESTART="false")
    assert quiet.returncode == 0
    assert quiet.stdout == ""

    # "Press the button again" — same commit, new signal — retries it.
    box.signal(target, "again")
    retried = box.run()
    assert retried.returncode == 0, retried.stdout
    assert "DEPLOYED " + target in retried.stdout


def test_a_commit_that_master_does_not_contain_is_refused(box):
    git(box.dev, "checkout", "-q", "-b", "side")
    (box.dev / "src").mkdir(exist_ok=True)
    (box.dev / "src" / "evil.py").write_text("boom")
    git(box.dev, "add", "-A")
    git(box.dev, "commit", "-q", "-m", "side")
    stray = git(box.dev, "rev-parse", "HEAD")
    git(box.dev, "push", "-q", "origin", "side")
    box.signal(stray)

    result = box.run()
    assert result.returncode == 1
    assert "is not on origin/master" in result.stdout
    assert box.steps() == []
    assert box.head() != stray


def test_local_work_on_the_server_is_never_overwritten(box):
    target = box.commit("src/aivinnet/app.py", "x = 4")
    box.signal(target)
    (box.server / "README.md").write_text("edited on the box")

    result = box.run()
    assert result.returncode == 1
    assert "uncommitted changes" in result.stdout
    assert (box.server / "README.md").read_text() == "edited on the box"
    assert box.steps() == []


def test_a_rollback_deploys_the_older_commit(box):
    old = box.commit("src/aivinnet/app.py", "x = 5")
    new = box.commit("src/aivinnet/app.py", "x = 6")
    box.signal(new, "forward")
    assert box.run().returncode == 0
    assert box.head() == new

    box.signal(old, "back")
    result = box.run()
    assert result.returncode == 0, result.stdout
    assert box.head() == old
    assert (box.server / "src" / "aivinnet" / "app.py").read_text() == "x = 5"
