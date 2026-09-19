"""
Guard: no third-party streaming brand is named anywhere in this repository.

The repo is public, and AivinNet describes its own UI on its own terms — in
code, comments, docs and tests alike. The name used to be sprinkled through
~40 comments as a style shorthand ("… -style"), a font option carried it in its
label and stored value, and a context menu linked out to the service.

The brand is assembled at runtime so this guard does not name it either. The
check covers every tracked text file, not only shipped code: a comment or a doc
line is exactly where the shorthand crept in.
"""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = re.compile("".join(["s", "p", "o", "t", "i", "f", "y"]), re.IGNORECASE)

# Vendored third-party code is not ours to reword.
SKIPPED_PREFIXES = ("src/aivinnet/lib/pydub/",)
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".flac"}


def _tracked_files() -> list[str]:
    # `git ls-files`, not a directory walk: it skips node_modules, .venv and
    # build output by construction. A failure here must fail the test — a guard
    # that silently checks nothing looks exactly like a clean repo.
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    files = [line for line in out.splitlines() if line]
    assert len(files) > 100, f"git ls-files returned only {len(files)} files — not a real checkout?"
    return files


def test_no_third_party_brand_in_tracked_files():
    offenders = []
    for rel in _tracked_files():
        if rel.startswith(SKIPPED_PREFIXES) or Path(rel).suffix.lower() in BINARY_SUFFIXES:
            continue
        path = ROOT / rel
        if not path.is_file():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if BRAND.search(line):
                offenders.append(f"{rel}:{number}: {line.strip()[:100]}")

    assert not offenders, "Third-party brand named (describe the behaviour instead):\n" + "\n".join(offenders)
