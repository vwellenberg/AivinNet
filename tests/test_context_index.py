"""The always-loaded index of rules and docs (`.claude/INDEX.md`) stays complete.

Area rules load only when a matching file is opened with the Read tool. A
session that reads code through the shell never sees them: Quick play was built
that way, `client/.claude/rules/styling.md` (2570 lines) never loaded, and the
selected row put the hatch behind its text (2026-11-22). The index is the one
place that is always in context, so a rule or doc missing from it is invisible
in exactly that situation, and a path in it that no longer exists sends the
reader nowhere.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / ".claude" / "INDEX.md"

# Every file in these folders must be listed.
LISTED_DIRS = [".claude/rules", "client/.claude/rules", "docs", "client/docs"]

# Named in the index on purpose, but not in the repository.
NOT_IN_REPO = {"MAINTAINER.local.md"}


def _index_text() -> str:
    return INDEX.read_text(encoding="utf-8")


def _referenced_paths() -> set[str]:
    """Paths in backticks that point at a Markdown file."""
    return set(re.findall(r"`([\w./-]+\.md)`", _index_text()))


def test_index_exists_and_is_imported():
    assert INDEX.is_file()
    claude_md = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    # Only an `@` import on a line of its own loads the file into every session;
    # a Markdown link would leave it to be opened on request.
    assert re.search(r"^@\.claude/INDEX\.md$", claude_md, re.M), "CLAUDE.md does not import .claude/INDEX.md"


def test_index_parser_sees_references():
    # A broken pattern would make both tests below pass on an empty set.
    refs = _referenced_paths()
    assert "client/.claude/rules/styling.md" in refs
    assert len(refs) >= 15


def test_every_rule_and_doc_is_listed():
    refs = _referenced_paths()
    missing = [
        f"{folder}/{path.name}"
        for folder in LISTED_DIRS
        for path in sorted((ROOT / folder).glob("*.md"))
        if f"{folder}/{path.name}" not in refs
    ]
    assert not missing, f"not in .claude/INDEX.md: {missing}"


def test_every_listed_path_exists():
    gone = sorted(ref for ref in _referenced_paths() if ref not in NOT_IN_REPO and not (ROOT / ref).is_file())
    assert not gone, f".claude/INDEX.md points at files that do not exist: {gone}"
