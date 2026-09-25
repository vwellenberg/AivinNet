"""`client/scripts/prune-serve-assets.sh` — the one thing in the deploy that
DELETES from the directory the running app serves.

It lived inside deploy-client.sh, where the only way to find out that a
condition was wrong was to run a deploy. Its two conditions are easy to state
and easy to get backwards, and both failure modes are quiet in opposite
directions: too strict keeps twenty builds (what actually happened — the window
was 7 *days* while the client is deployed several times a day), too loose
deletes the chunks a tab open across the deploy is about to lazy-load.
"""

import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "client" / "scripts" / "prune-serve-assets.sh"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash (the CI lane has it)")


def age(path: Path, minutes: int):
    """Backdate a file, the way a deploy from N minutes ago would leave it."""
    when = time.time() - minutes * 60
    os.utime(path, (when, when))


@pytest.fixture()
def dirs(tmp_path):
    serve = tmp_path / "serve" / "assets"
    dist = tmp_path / "dist" / "assets"
    serve.mkdir(parents=True)
    dist.mkdir(parents=True)
    return serve, dist


def prune(serve: Path, dist: Path, grace: int = 1440):
    result = subprocess.run(
        ["bash", str(SCRIPT), str(serve), str(dist), str(grace)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout + result.stderr


def test_an_old_orphan_goes(dirs):
    serve, dist = dirs
    (dist / "index.new.js").write_text("current")
    (serve / "index.new.js").write_text("current")
    stale = serve / "index.old.js"
    stale.write_text("from a build two days ago")
    age(stale, minutes=2 * 1440)

    output = prune(serve, dist)

    assert not stale.exists()
    assert "PRUNED 1 " in output


def test_a_fresh_orphan_stays_for_the_tab_that_is_still_running_it(dirs):
    serve, dist = dirs
    (dist / "index.new.js").write_text("current")
    recent = serve / "index.previous.js"
    recent.write_text("deployed an hour ago")
    age(recent, minutes=60)

    output = prune(serve, dist)

    assert recent.exists()
    assert "PRUNED 0 " in output
    assert "1 still within the grace window" in output


def test_a_file_of_the_current_build_is_never_touched_however_old_it_looks(dirs):
    """Age alone must not be enough — an asset that has not changed in weeks is
    still being served."""
    serve, dist = dirs
    (dist / "logo.stable.svg").write_text("<svg/>")
    current = serve / "logo.stable.svg"
    current.write_text("<svg/>")
    age(current, minutes=90 * 1440)

    prune(serve, dist)

    assert current.exists()


def test_an_empty_build_deletes_nothing(dirs):
    """A build that produced no assets would make every served file an orphan.
    The app would be gone, on a deploy that reported success."""
    serve, dist = dirs
    served = serve / "index.js"
    served.write_text("the whole app")
    age(served, minutes=90 * 1440)

    output = prune(serve, dist)

    assert served.exists()
    assert "PRUNE_SKIPPED" in output


def test_a_missing_directory_is_not_an_error(dirs):
    """First deploy onto a fresh box: there is nothing to prune yet, and the
    deploy must not stop over it."""
    serve, dist = dirs
    (dist / "index.js").write_text("current")

    output = prune(serve.parent / "nope", dist)

    assert "PRUNE_SKIPPED" in output


def test_the_grace_window_is_the_boundary_it_claims(dirs):
    """`-mmin +N` excludes exactly N — the off-by-one that would silently keep
    one build too many forever."""
    serve, dist = dirs
    (dist / "index.new.js").write_text("current")
    for name, minutes in (("just.inside.js", 59), ("well.outside.js", 600)):
        path = serve / name
        path.write_text("x")
        age(path, minutes=minutes)

    prune(serve, dist, grace=60)

    assert (serve / "just.inside.js").exists()
    assert not (serve / "well.outside.js").exists()
