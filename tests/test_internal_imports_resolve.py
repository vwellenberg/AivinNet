"""Every `from aivinnet.x import y` must point at a module that exists.

The package rename (swingmusic -> aivinnet) rewrote import statements by text.
`src/aivinnet/start_swingmusic.py` kept its file name while `__main__.py` was
rewritten to `from aivinnet.start_aivinnet import start_aivinnet` — a crash on
the very first line of the app, invisible to all 589 other tests, because none
of them import the startup path.

This walks the AST of every module in the package and resolves each internal
import against the file tree. No imports are executed, so the fast lane's
mocked dependencies cannot hide anything and nothing needs Flask installed.
"""

import ast
from pathlib import Path

PACKAGE = "aivinnet"
SRC = Path(__file__).resolve().parents[1] / "src"
PACKAGE_ROOT = SRC / PACKAGE

# Vendored third-party code is not ours to keep consistent.
SKIP_PARTS = {"pydub"}


def _module_files():
    for path in PACKAGE_ROOT.rglob("*.py"):
        if not set(path.parts) & SKIP_PARTS:
            yield path


def _exists(dotted: str) -> bool:
    """True if `aivinnet.a.b` resolves to a module or package on disk."""
    parts = dotted.split(".")
    if parts[0] != PACKAGE:
        return True  # third-party import, not our business

    base = SRC.joinpath(*parts)
    return base.with_suffix(".py").is_file() or (base / "__init__.py").is_file()


def _imported_names(tree: ast.AST, module_path: Path) -> list[str]:
    """Absolute dotted targets of every import in one module."""
    names: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                # Relative import: resolve against the containing package.
                package_parts = module_path.relative_to(SRC).parts[:-1]
                base = list(package_parts[: len(package_parts) - node.level + 1])
                names.append(".".join(base + ([node.module] if node.module else [])))
            elif node.module:
                names.append(node.module)
                # `from aivinnet.api import album` — album is a module too.
                names.extend(f"{node.module}.{alias.name}" for alias in node.names)

    return names


def test_every_internal_import_resolves_to_a_file():
    broken: list[str] = []

    for path in _module_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for dotted in _imported_names(tree, path):
            if not dotted.startswith(PACKAGE):
                continue
            # `from aivinnet.models import Track` names a class, not a module;
            # only flag a target when its PARENT package resolves but it does
            # not — that is the shape a rename breaks.
            if _exists(dotted):
                continue
            parent = dotted.rsplit(".", 1)[0]
            if parent == PACKAGE or _exists(parent):
                continue
            broken.append(f"{path.relative_to(SRC)}: {dotted}")

    assert not broken, "Imports pointing at modules that do not exist:\n" + "\n".join(sorted(broken))


def test_the_package_directory_is_named_after_the_distribution():
    """A leftover `swingmusic` directory would mean the rename was partial."""
    assert PACKAGE_ROOT.is_dir(), f"expected the package at {PACKAGE_ROOT}"
    assert not (SRC / "swingmusic").exists(), "src/swingmusic still exists — the rename is half done"


def test_nothing_imports_the_old_package_name():
    """No module may import `swingmusic` — that package no longer exists.

    This is the half of the rename the resolver above cannot see: an import of
    a package that is gone entirely, rather than a missing submodule of ours.
    About 100 `from swingmusic.db...` lines survived the rename because the
    literal `swingmusic.db` was protected as the DATABASE FILE name, and every
    one of them would have been an ImportError at startup. The fast test lane
    could not catch it — it mocks `swingmusic.db` away on purpose (see
    .claude/rules/tests.md), so all 589 tests stayed green.
    """
    offenders: list[str] = []
    roots = [PACKAGE_ROOT, SRC.parent / "tests", SRC.parent / "tests_api"]

    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*.py"):
            if set(path.parts) & SKIP_PARTS:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "swingmusic":
                    offenders.append(f"{path.name}:{node.lineno}: from {node.module}")
                elif isinstance(node, ast.Import):
                    offenders += [
                        f"{path.name}:{node.lineno}: import {a.name}"
                        for a in node.names
                        if a.name.split(".")[0] == "swingmusic"
                    ]

    assert not offenders, "Imports of the old package name:\n" + "\n".join(sorted(offenders))
