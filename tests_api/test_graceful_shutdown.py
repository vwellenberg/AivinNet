"""
The server has to stop by itself when asked to — `docker stop` and systemd ask
with SIGTERM, a terminal with SIGINT.

It did neither. SIGTERM was not handled at all (as PID 1 in a container the
kernel drops it, so Docker SIGKILLed the server after its grace period, exit
137), and after SIGINT bjoern returned but the never-ending cron loop, a
non-daemon thread, kept the process alive.

Runs the real server in a subprocess: a stop only means something for the
whole process, cron thread and WSGI loop included. Outside a container the
process is not PID 1, so an unhandled SIGTERM kills it instead of being
dropped — which is why the test insists on exit code 0 (a handled stop) and
on the checkpointed WAL, not merely on "the process is gone".
"""

import os
import signal
import socket
import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="bjoern, POSIX signals")

# Well under Docker's 10 s grace period, with room for a slow CI runner.
STOP_DEADLINE = 5


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_port(port: int, proc: subprocess.Popen, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            pytest.fail(f"server exited during startup: {proc.stdout.read()}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return
        except OSError:
            time.sleep(0.3)
    pytest.fail("server never opened its port")


@pytest.mark.parametrize(
    ("sig", "keep_alive"),
    [(signal.SIGTERM, False), (signal.SIGINT, False), (signal.SIGTERM, True)],
    # keep-alive: an open browser tab. bjoern's loop waits for that connection
    # with no timeout, so without the drain deadline the stop still hangs.
    ids=["SIGTERM", "SIGINT", "SIGTERM-idle-keep-alive"],
)
def test_server_stops_cleanly_on_signal(tmp_path, sig, keep_alive):
    client = tmp_path / "client"
    client.mkdir()
    # A stub client: the real one would be downloaded from GitHub on startup.
    (client / "index.html").write_text("<!doctype html><title>stub</title>")
    config = tmp_path / "config"
    config.mkdir()
    port = _free_port()

    proc = subprocess.Popen(
        [
            *(sys.executable, "-m", "aivinnet", "--host", "127.0.0.1", "--port", str(port)),
            *("--config", str(config), "--client", str(client)),
        ],
        env={**os.environ, "AIVINNET_ADMIN_PASSWORD": "shutdown-test"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    idle = None
    try:
        _wait_for_port(port, proc)
        # Once a request went through, the cron thread is running as well.
        conn = socket.create_connection(("127.0.0.1", port), timeout=5)
        connection = b"keep-alive" if keep_alive else b"close"
        conn.sendall(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: " + connection + b"\r\n\r\n")
        assert conn.recv(12).startswith(b"HTTP/1.1")
        if keep_alive:
            idle = conn  # stays open, and idle, through the stop
        else:
            conn.close()

        started = time.monotonic()
        proc.send_signal(sig)
        try:
            proc.wait(timeout=STOP_DEADLINE)
        except subprocess.TimeoutExpired:
            pytest.fail(f"still running {STOP_DEADLINE} s after {sig.name}")
        output = proc.stdout.read()
        took = time.monotonic() - started
    finally:
        if idle is not None:
            idle.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait()

    assert proc.returncode == 0, f"exit {proc.returncode} after {sig.name} ({took:.1f} s):\n{output}"

    # The database was closed, not abandoned: closing the last connection folds
    # the WAL back into the database and deletes it.
    db = config / "aivinnet" / "aivinnet.db"
    assert db.exists()
    assert not db.with_name("aivinnet.db-wal").exists(), "database left open: WAL not checkpointed"
