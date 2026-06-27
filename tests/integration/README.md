# Integration tests

Tests that need the **real** backend live here: they run against the actual
Flask / SQLAlchemy / mutagen libraries (installed via `uv sync`) and, going
forward, the app/DB fixture. Mark each one with `@pytest.mark.integration`.

They are kept in this dedicated directory — separate from the fast unit tests in
`tests/` — on purpose: the unit tests inject `MagicMock` into `sys.modules` for
heavy deps at import time, which would poison the real libraries if both were
collected in the same pytest session. The CI `Unit Tests` job therefore passes
`--ignore=tests/integration`, and the `Integration Tests` job collects only this
directory.
