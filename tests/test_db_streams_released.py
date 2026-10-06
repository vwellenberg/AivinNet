"""Census: no database stream may outlive its session (#363, #367).

A streamed (`yield_per`) result that its caller stops reading early keeps its
SQLite statement — a read snapshot — open on the pooled connection. Under
SQLAlchemy 2.1 nothing resets it when the session closes, and the next writer
handed that connection fails at once with "database is locked".

Calls through `cls.execute(...)` are safe: `Base.execute` freezes the result
before the session closes. What this census guards is every OTHER place that
runs a `yield_per` statement on a session or connection of its own: it must
either freeze the result or close it in a `finally`.
"""

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src" / "aivinnet"
VENDORED = SRC / "lib" / "pydub"


def _streaming_functions():
    """(file, function, released) for each function that streams on its own."""
    for path in sorted(SRC.rglob("*.py")):
        if VENDORED in path.parents:
            continue
        source = path.read_text(encoding="utf-8")
        if "yield_per" not in source:
            continue
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.FunctionDef):
                continue
            # The argument itself, not the word: a comment may name it.
            if not any(isinstance(kw, ast.keyword) and kw.arg == "yield_per" for kw in ast.walk(node)):
                continue
            own_execute = any(
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Attribute)
                and call.func.attr == "execute"
                and not (isinstance(call.func.value, ast.Name) and call.func.value.id == "cls")
                for call in ast.walk(node)
            )
            if not own_execute:
                continue
            frozen = any(
                isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "freeze"
                for call in ast.walk(node)
            )
            closed_finally = any(
                isinstance(tri, ast.Try)
                and any(
                    isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "close"
                    for stmt in tri.finalbody
                    for call in ast.walk(stmt)
                )
                for tri in ast.walk(node)
            )
            yield path.relative_to(SRC).as_posix(), node.name, frozen or closed_finally


def test_every_own_stream_is_frozen_or_closed():
    leaks = [f"{f}::{fn}" for f, fn, released in _streaming_functions() if not released]
    assert not leaks, (
        "A `yield_per` result run on its own session/connection must be frozen "
        "(`result.freeze()()`) or closed in a `finally` — otherwise a reader that "
        f"stops early locks the database for the next writer (#363): {leaks}"
    )


def test_the_census_sees_the_known_streams():
    # Without this the census could pass by finding nothing at all.
    found = {(f, fn) for f, fn, _ in _streaming_functions()}
    assert ("db/__init__.py", "execute") in found
    assert ("db/libdata.py", "get_all") in found
