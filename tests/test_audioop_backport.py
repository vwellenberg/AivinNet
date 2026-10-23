"""Python 3.13 removed `audioop`, and the vendored pydub needs it (#574).

`pydub/utils.py` swallows the ImportError, but `audio_segment.py` then
imports the name from there, so on 3.13 `lib/trackslib.py` (and with it
`api/stream.py`) fails to import and the app does not start.
`requires-python = ">=3.11"` lets 3.13 in, so the backport `audioop-lts`
must come with it. CI, Docker and the AppImage all run 3.11 and never
noticed; `API Tests (Python 3.13)` in ci.yml now runs the full stack there.

This check is static so it is red on any interpreter, the 3.11 fast lane
included.
"""

import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PYDUB = REPO_ROOT / "src" / "aivinnet" / "lib" / "pydub"


def _pydub_uses_audioop() -> bool:
    return any(
        re.search(r"^\s*import audioop\b", path.read_text(encoding="utf-8"), re.MULTILINE)
        for path in PYDUB.rglob("*.py")
    )


def test_pydub_still_needs_audioop():
    # If a pydub update drops audioop, this file and the dependency can go.
    assert _pydub_uses_audioop()


def test_the_backport_is_declared_for_python_313():
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    backport = [dep for dep in pyproject["project"]["dependencies"] if dep.startswith("audioop-lts")]
    assert backport, "add `audioop-lts; python_version >= '3.13'` (uv add)"
    # Only from 3.13 on: before that `audioop` is in the stdlib, and the
    # backport refuses to install there.
    assert re.search(r"python(_full)?_version\s*>=\s*'3\.13'", backport[0]), backport[0]


def test_the_backport_is_locked():
    # Releases install exactly uv.lock (#300); a dependency missing there ships missing.
    lock = (REPO_ROOT / "uv.lock").read_text(encoding="utf-8")
    assert '\nname = "audioop-lts"\n' in lock
