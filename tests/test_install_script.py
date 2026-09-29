"""install.sh is run as `curl | bash`, on machines we never see.

Found by the pre-release audit (#300) and the update test in a clean container.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

INSTALLER = Path(__file__).resolve().parents[1] / "install.sh"
BASH = shutil.which("bash")
needs_bash = pytest.mark.skipif(BASH is None, reason="no bash on this machine")


def _source() -> str:
    return INSTALLER.read_text(encoding="utf-8")


@needs_bash
@pytest.mark.parametrize("fraction", [0.2, 0.4, 0.6, 0.8, 0.95, 0.999])
def test_a_download_cut_short_runs_nothing(tmp_path, fraction):
    """Piped from curl, bash executes what has arrived so far. Wrapped in main(),
    any prefix ends inside the function body and fails to parse; unwrapped, the
    prefix could stop the service and delete the old install."""
    data = INSTALLER.read_bytes()
    cut = tmp_path / "cut.sh"
    cut.write_bytes(data[: int(len(data) * fraction)])

    result = subprocess.run([BASH, "-n", str(cut)], capture_output=True)

    assert result.returncode != 0, f"a {fraction:.0%} prefix still parses — it would run"


@needs_bash
def test_the_whole_script_still_parses_and_answers_help():
    result = subprocess.run([BASH, str(INSTALLER), "--help"], capture_output=True, text=True)

    assert result.returncode == 0
    assert "Usage" in result.stdout


def test_the_last_line_is_the_only_call():
    lines = [line for line in _source().splitlines() if line.strip()]

    assert lines[-1] == 'main "$@"'


def test_host_discovery_cannot_end_the_script():
    """Under `set -o pipefail` a failing `hostname -I` aborted after the service
    started, before the URL and the admin password were printed."""
    for line in _source().splitlines():
        if "hostname -I" in line or "ip route get" in line:
            assert "|| true" in line, line


def test_an_update_keeps_the_mount_guard():
    """The unit is rewritten on every run; an update carries no --music."""
    source = _source()

    assert re.search(r"sed -n 's/\^RequiresMountsFor=//p'", source)
    assert "RequiresMountsFor=${mount_path}" in source


def test_a_slow_start_is_not_reported_as_a_failed_install():
    source = _source()
    block = source[source.index("Waiting for the server to answer") :]
    block = block[: block.index('log "AivinNet ${tag} is installed"')]

    assert "die " not in block
