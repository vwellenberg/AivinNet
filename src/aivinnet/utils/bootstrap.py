"""First-run bootstrap values.

Deliberately free of heavy imports so the logic stays unit-testable without a
database or Flask.
"""

import os
from collections.abc import Mapping

ADMIN_PASSWORD_ENV = "AIVINNET_ADMIN_PASSWORD"
"""Environment variable holding the password for the admin account created on first run."""

FALLBACK_ADMIN_PASSWORD = "admin"
"""Upstream's well-known default, used when nothing is configured."""


def initial_admin_password(env: Mapping[str, str] | None = None) -> str:
    """
    Resolve the password for the admin user created on the very first start.

    Read from the environment rather than a command line flag on purpose:
    process arguments are world-readable via ``/proc/<pid>/cmdline``, whereas
    the environment of a process is only readable by its owner (and root).

    Whitespace is stripped because the value usually arrives through a systemd
    ``EnvironmentFile``, where a trailing newline is easy to introduce and would
    otherwise silently produce a password nobody can type.
    """
    if env is None:
        env = os.environ

    return env.get(ADMIN_PASSWORD_ENV, "").strip() or FALLBACK_ADMIN_PASSWORD
