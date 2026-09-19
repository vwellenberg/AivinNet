"""
Guard against new `swingmusic` / "Swing Music" leftovers in shipped code.

The rename to AivinNet (2026-08-07) left names behind in places no test looked
at — the API docs title, a log directory, environment variables, a Docker
label — and each was found by accident, months apart. What may legitimately
still carry the old name is listed here, WITH the reason; anything else fails.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCANNED = [ROOT / "src" / "aivinnet", ROOT / "client" / "src", ROOT / "Dockerfile"]
SKIPPED_DIRS = {ROOT / "src" / "aivinnet" / "lib" / "pydub"}  # vendored
SUFFIXES = {".py", ".ts", ".vue", ".js", ".scss", ".css", ".html", ""}

DISPLAY_NAME = re.compile(r"swing\s*music", re.IGNORECASE)
UPSTREAM_URL = "swingmx/"  # attribution, required by the AGPL — always fine

# file (relative to ROOT) -> why the old name belongs there
ALLOWED = {
    # The migration itself: it has to know the old directory, db and env names.
    "src/aivinnet/legacy_paths.py": "legacy names are the migration's input",
    "src/aivinnet/settings.py": "documents the legacy fallbacks it resolves",
    "src/aivinnet/logger.py": "documents where old logs are moved from",
    "src/aivinnet/api/backup_and_restore.py": "a realistic traversal example path",
    # UI attribution and a statement about the upstream mobile app.
    "client/src/components/SettingsView/About.vue": "upstream attribution",
    "client/src/components/modals/settings/custom/Pairing.vue": "refers to upstream's native app",
    "client/src/stores/colors.ts": "removes the store's old persisted key",
    "client/src/components/__tests__/backupDirLabel.test.ts": "asserts the old path is gone",
}


def _files():
    for base in SCANNED:
        paths = [base] if base.is_file() else base.rglob("*")
        for path in paths:
            if not path.is_file() or path.suffix not in SUFFIXES:
                continue
            if any(skipped in path.parents for skipped in SKIPPED_DIRS) or "node_modules" in path.parts:
                continue
            yield path


def test_no_upstream_name_outside_the_allowlist():
    offenders = []
    for path in _files():
        rel = path.relative_to(ROOT).as_posix()
        if rel in ALLOWED:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if UPSTREAM_URL in line:
                continue
            if DISPLAY_NAME.search(line):
                offenders.append(f"{rel}:{number}: {line.strip()[:100]}")

    assert not offenders, "Old name in shipped code (rename, or add to ALLOWED with a reason):\n" + "\n".join(offenders)


def test_allowlist_has_no_stale_entries():
    # An entry whose file no longer mentions the name would silently widen the
    # guard the next time someone adds a leftover to that file.
    stale = [
        rel
        for rel in ALLOWED
        if not (ROOT / rel).is_file() or not DISPLAY_NAME.search((ROOT / rel).read_text(encoding="utf-8"))
    ]
    assert not stale, f"ALLOWED entries that no longer need it: {stale}"
