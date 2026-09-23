"""Every outbound HTTP call carries a deadline.

`requests` has **no default timeout**: without one a call waits for the peer
forever. Two things in this app turn that into more than a slow request.

* In a request handler it freezes the whole app. bjoern is evented and
  single-threaded, so one stuck handler stops every other request, including
  `/` — see the architecture notes in CLAUDE.md.
* In a background thread it stops the process from exiting. `@background`
  threads are plain `threading.Thread`s, i.e. **not** daemons, so a hung call
  keeps the interpreter alive after the server is done — which is how a
  container stop ends in SIGKILL.

`prefer_ipv4()` covers only the IPv6 half of this (a DS-Lite line where AAAA
records hang); an unreachable or silent peer still waits forever. So the rule is
a census over the source, not a fixed list: a new call site joins it by existing.
Pooled sessions count too — `requests.Session()` has no default timeout either,
and the lyrics plugin (on by default, called while a page waits) uses one.

Found by this census when it was written: `plugins/lastfm.py` posted scrobbles
with no timeout at all — the one call site in the whole app that had none.
"""

import re
from pathlib import Path

import pytest

SRC = Path(__file__).parent.parent / "src" / "aivinnet"
VENDORED = SRC / "lib" / "pydub"  # third party, not ours to change

VERBS = "get|post|put|patch|delete|head|request"
CALL = re.compile(rf"\brequests\.({VERBS})\s*\(")
# A pooled session sends just as much, and `requests.Session()` carries no
# default timeout either. Only names that a file assigns FROM requests count —
# `session.get(...)` on a SQLAlchemy session is a different thing entirely.
SESSION_BOUND = re.compile(r"(?:self\.)?(\w+)\s*=\s*requests\.Session\s*\(")


def call_sites():
    """(file, line, source of the call) for every outbound call in src/."""
    for path in sorted(SRC.rglob("*.py")):
        if VENDORED in path.parents:
            continue
        source = path.read_text(encoding="utf-8")

        patterns = [CALL]
        for name in set(SESSION_BOUND.findall(source)):
            patterns.append(re.compile(rf"\b(?:self\.)?{re.escape(name)}\.({VERBS})\s*\("))

        for pattern in patterns:
            for match in pattern.finditer(source):
                yield path, source[: match.start()].count("\n") + 1, _call_source(source, match.end() - 1)


def _call_source(source: str, open_paren: int) -> str:
    """The text of one call, from `(` to its matching `)` — calls span lines."""
    depth = 0
    for i in range(open_paren, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                return source[open_paren : i + 1]
    raise AssertionError("unbalanced parentheses — the parser is broken, not the code")


SITES = list(call_sites())


def test_the_census_actually_reads_the_source():
    """A source-scanning test that finds nothing passes. Pin its input."""
    assert len(SITES) >= 8
    files = {path.name for path, _, _ in SITES}
    assert {"lastfm.py", "coverart.py", "musicbrainz.py"} <= files
    assert any("timeout" in call for _, _, call in SITES)
    # The pooled-session half has exactly one call site today; if the census
    # stops seeing it, it stops seeing that whole shape.
    assert "lyrics.py" in files


@pytest.mark.parametrize("site", SITES, ids=lambda s: f"{s[0].name}:{s[1]}")
def test_every_outbound_call_passes_a_timeout(site):
    path, line, call = site

    assert "timeout" in call, (
        f"{path.relative_to(SRC.parent.parent)}:{line} calls requests without a timeout. "
        "Without one the call can wait forever: in a handler that freezes the whole "
        "app (single-threaded bjoern), in a @background thread it keeps the process "
        "from exiting."
    )
