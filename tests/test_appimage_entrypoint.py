"""`kill <pid>` of the AppImage must stop the server (#300).

python-appimage's `usr/bin/python` is a bash wrapper that starts the real
interpreter as a CHILD, without `exec`. The entrypoint used to exec into that
wrapper, so the PID a user (or a test, or `--no-autostart`) holds was the
wrapper: SIGTERM ended it and the server ran on as an orphan, port and all.
Measured on the released v2026.10.3. systemd hid it (KillMode=control-group).

The AppDir here has the real layout: a wrapper shaped like python-appimage's
under usr/bin, the interpreter under opt/. The "interpreter" records what it
was started with and then becomes `sleep`, so the test can see which process
the launched PID ends up as.
"""

import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

import pytest

ENTRYPOINT = Path(__file__).resolve().parents[1] / "appimage" / "entrypoint.sh"

pytestmark = pytest.mark.skipif(
    not Path("/proc/self/comm").exists() or shutil.which("bash") is None or shutil.which("sleep") is None,
    reason="needs bash and /proc (Linux)",
)

WRAPPER = """#! /bin/bash
export SSL_CERT_FILE="${APPDIR}/opt/_internal/certs.pem"
"$APPDIR/opt/python3.11/bin/python3.11" "$@"
"""

INTERPRETER = """#! /bin/sh
printf '%s\\n' "$SSL_CERT_FILE" "$LD_LIBRARY_PATH" "$@" > "$APPDIR/started-with"
exec sleep 30
"""


def _executable(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o755)


@pytest.fixture()
def appdir(tmp_path):
    _executable(tmp_path / "usr" / "bin" / "python", WRAPPER)
    _executable(tmp_path / "opt" / "python3.11" / "bin" / "python3.11", INTERPRETER)
    # Sorts before the interpreter and is executable: never the one to run.
    _executable(tmp_path / "opt" / "python3.11" / "bin" / "python3.11-config", "#! /bin/sh\nexit 1\n")
    (tmp_path / "opt" / "_internal").mkdir()
    (tmp_path / "opt" / "_internal" / "certs.pem").write_text("")
    return tmp_path


def _comm(pid: int) -> str:
    return Path(f"/proc/{pid}/comm").read_text().strip()


def _start(appdir: Path, *args: str) -> subprocess.Popen:
    # Its own process group, so cleanup also reaches an orphaned child: that
    # orphan is exactly what this file is about.
    return subprocess.Popen(
        ["bash", str(ENTRYPOINT), *args], env={**os.environ, "APPDIR": str(appdir)}, start_new_session=True
    )


def _stop(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait(timeout=10)


def test_the_launched_pid_is_the_server_itself(appdir):
    proc = _start(appdir, "--host", "127.0.0.1")
    try:
        deadline = time.monotonic() + 10
        while not (appdir / "started-with").exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        while _comm(proc.pid) != "sleep" and time.monotonic() < deadline:
            time.sleep(0.05)

        # One process, not a wrapper with a child: SIGTERM reaches the server.
        assert _comm(proc.pid) == "sleep"

        cert, libs, *args = (appdir / "started-with").read_text().splitlines()
        assert cert == f"{appdir}/opt/_internal/certs.pem", "the stdlib's TLS needs the bundled CA file"
        assert libs.startswith(f"{appdir}/usr/lib:"), "bjoern needs the bundled libev"
        assert args == ["-m", "aivinnet", "--client", f"{appdir}/client", "--host", "127.0.0.1"]
    finally:
        _stop(proc)


def test_without_an_interpreter_under_opt_it_still_starts(appdir, monkeypatch):
    """A changed python-appimage layout falls back to the wrapper rather than not starting."""
    shutil.rmtree(appdir / "opt")
    _executable(appdir / "usr" / "bin" / "python", INTERPRETER)
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)

    proc = _start(appdir)
    try:
        deadline = time.monotonic() + 10
        while not (appdir / "started-with").exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        cert, *_ = (appdir / "started-with").read_text().splitlines()
        assert cert == "", "no bundle, no SSL_CERT_FILE: a dangling one breaks every TLS check"
    finally:
        _stop(proc)


def test_the_release_refuses_an_appdir_without_that_interpreter():
    """The fallback keeps a changed layout starting; the release must not ship one silently."""
    workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
    step = workflow[workflow.index("- name: Verify the AppDir is complete") :]
    step = step[: step.index("- name:", 1)]
    code = "\n".join(line for line in step.splitlines() if not line.strip().startswith("#"))

    assert '[ -x "$dir/bin/${dir##*/}" ]' in code, "the gate must look up the interpreter as the entrypoint does"
    assert re.search(r'test -n "\$interpreter" \\\n\s*\|\| \{ echo "::error::[^"]*"; exit 1; \}', code)
