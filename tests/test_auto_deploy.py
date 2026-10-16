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

import functools
import http.server
import os
import shutil
import subprocess
import threading
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
        # History starts before the button, like the real one: the server only
        # deploys commits that still carry the script (a rollback further back
        # would delete the timer's own command).
        self.before_button = self.commit("README.md", "one")
        self.commit("scripts/auto-deploy.sh", "# the script")
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


@pytest.fixture()
def served(tmp_path):
    """What the backend hands out at `/`: a folder behind a real HTTP server."""
    root = tmp_path / "served"
    root.mkdir()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield root, httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


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

    before = box.head()
    failing = box.run(RESTART="false")
    assert failing.returncode == 1
    assert "FAILED " + target in failing.stdout
    assert not (box.state / "deployed").exists()
    # Nothing went live, so the checkout is back on what is running: a reboot
    # must not start code that was never deployed.
    assert box.head() == before

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


def test_a_commit_from_before_the_button_is_refused(box):
    # Checking it out would delete scripts/auto-deploy.sh, and the timer would
    # fail every minute from then on, on a box nobody reaches from outside.
    box.signal(box.commit("README.md", "two"), "first")
    assert box.run().returncode == 0
    box.log.unlink()
    box.signal(box.before_button, "rollback too far")

    result = box.run()
    assert result.returncode == 1
    assert "older than the deploy button" in result.stdout
    assert box.steps() == []
    assert (box.server / "scripts" / "auto-deploy.sh").exists()


def test_a_ref_that_is_no_signal_is_refused(box):
    # A commit without a parent, pushed to `deploy` by hand: there is nothing
    # it could name.
    tree = git(box.dev, "rev-parse", "HEAD^{tree}")
    orphan = git(box.dev, "commit-tree", tree, "-m", "by hand")
    git(box.dev, "push", "-q", "-f", "origin", f"{orphan}:refs/heads/deploy")
    before = box.head()

    result = box.run()
    assert result.returncode == 1
    assert "names no commit" in result.stdout
    assert box.steps() == []
    assert box.head() == before


def test_a_box_deployed_by_hand_since_gets_everything(box):
    # The plan starts from what is on disk, not from the last signal: after a
    # deploy by hand nobody knows which steps it ran.
    one = box.commit("client/src/a.vue", "a")
    box.signal(one, "first")
    assert box.run().returncode == 0
    box.log.unlink()

    box.commit("src/aivinnet/app.py", "x = 7")
    git(box.server, "fetch", "-q", "origin")
    git(box.server, "checkout", "-q", "-B", "master", "origin/master")  # by hand

    docs = box.commit("docs/x.md", "words")
    box.signal(docs, "after the hand deploy")
    result = box.run()
    assert result.returncode == 0, result.stdout
    assert box.steps() == ["backend-sync", "client-install", "restart", "client"]


def test_dependencies_come_first_and_the_client_after_the_restart(box):
    # The client's post-deploy gates test the new bundle against the backend it
    # is meant for, not against the process that ran before.
    box.signal(box.commit("README.md", "two"), "first")
    assert box.run().returncode == 0
    box.log.unlink()

    box.commit("uv.lock", "# lock")
    box.commit("client/yarn.lock", "# lock")
    target = box.commit("client/src/c.vue", "c")
    box.signal(target, "second")
    assert box.run().returncode == 0
    assert box.steps() == ["backend-sync", "client-install", "restart", "client"]


def test_local_commits_on_the_server_are_never_overwritten(box):
    target = box.commit("src/aivinnet/app.py", "x = 10")
    box.signal(target)
    (box.server / "notes.md").write_text("mine")
    git(box.server, "add", "notes.md")
    git(box.server, "commit", "-q", "-m", "on the box")
    mine = box.head()

    result = box.run()
    assert result.returncode == 1
    assert "commits that are not on origin/master" in result.stdout
    assert box.head() == mine
    assert box.steps() == []


def test_a_failed_restart_brings_back_what_ran(box):
    # `systemctl restart` can fail after its stop half; the box is out of
    # reach, so the old code is started again rather than left down.
    box.signal(box.commit("README.md", "two"), "first")
    assert box.run().returncode == 0
    box.log.unlink()
    before = box.head()

    flag = box.state / "restarted-once"
    restart = f"echo restart >> {box.log}; [ -e {flag} ] || {{ touch {flag}; exit 1; }}"
    box.signal(box.commit("src/aivinnet/app.py", "x = 11"), "second")
    result = box.run(RESTART=restart)
    assert result.returncode == 1
    assert box.head() == before
    assert box.steps() == ["restart", "restart"]


def test_a_first_signal_older_than_the_checkout_is_adopted_not_rolled_back(box):
    # Pressed once before the timer existed, then deployed by hand: the first
    # run of the timer must not quietly roll the box back to the old press.
    old = box.commit("src/aivinnet/app.py", "x = 8")
    box.signal(old, "before the timer")
    box.commit("src/aivinnet/app.py", "x = 9")
    git(box.server, "fetch", "-q", "origin")
    git(box.server, "checkout", "-q", "-B", "master", "origin/master")  # by hand
    newer = box.head()

    result = box.run()
    assert result.returncode == 0, result.stdout
    assert "adopted, not deployed" in result.stdout
    assert box.head() == newer
    assert box.steps() == []

    # Pressing it again for the same commit is the decision, and deploys it.
    box.signal(old, "again")
    assert box.run().returncode == 0
    assert box.head() == old


def test_the_served_entry_must_be_the_one_just_built(box, served):
    # The deploy is checked at the bytes the server hands out, not at the
    # build's word for it.
    root, port = served
    build = "mkdir -p client/dist && echo '<script src=\"/assets/index-new1.js\"></script>' > client/dist/index.html"
    env = {"CLIENT_DEPLOY": build, "VERIFY": "1", "PORT": str(port), "NO_PROXY": "*", "no_proxy": "*"}

    (root / "index.html").write_text('<script src="/assets/index-old0.js"></script>')
    box.signal(box.commit("client/src/a.vue", "a"), "stale")
    stale = box.run(**env)
    assert stale.returncode == 1
    assert "hands out 'assets/index-old0.js', the build is 'assets/index-new1.js'" in stale.stdout

    (root / "index.html").write_text('<script src="/assets/index-new1.js"></script>')
    box.signal(box.commit("client/src/b.vue", "b"), "fresh")
    fresh = box.run(**env)
    assert fresh.returncode == 0, fresh.stdout
    assert "served entry: assets/index-new1.js" in fresh.stdout


def test_the_client_deploy_is_told_which_folder_is_the_client(box):
    # deploy-client.sh calls the CLIENT folder REPO. The REPO this script runs
    # with (the checkout) must not leak into it, or it builds in the root.
    record = f'echo "REPO=$REPO BACKEND=$BACKEND" >> {box.log}'
    box.signal(box.commit("client/scripts/deploy-client.sh", record + "\n"), "real default")
    # No CLIENT_DEPLOY in the environment: the script's own default runs.
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        env={
            **{k: v for k, v in os.environ.items() if k != "CLIENT_DEPLOY"},
            **GIT_ENV,
            "REPO": str(box.server),
            "STATE": str(box.state),
            "GIT_FETCH_FLAGS": "",
            "CLIENT_INSTALL": "true",
            "BACKEND_SYNC": "true",
            "RESTART": "true",
            "HEALTH": "true",
            "VERIFY": "0",
        },
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert box.log.read_text().strip() == f"REPO={box.server}/client BACKEND={box.server}"
