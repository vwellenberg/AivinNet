"""First-run bootstrap values.

Deliberately free of heavy imports so the logic stays unit-testable without a
database or Flask.
"""

import os
import secrets
from collections.abc import Mapping

ADMIN_PASSWORD_ENV = "AIVINNET_ADMIN_PASSWORD"
"""Environment variable holding the password for the admin account created on first run."""

GENERATED_PASSWORD_BYTES = 12
"""Entropy of a generated password, in bytes (~96 bits, 16 url-safe characters)."""


def initial_admin_password(env: Mapping[str, str] | None = None) -> tuple[str, bool]:
    """
    Resolve the password for the admin user created on the very first start.

    Returns ``(password, was_generated)``. The flag matters: a generated password
    is the only copy in existence and has to be shown to whoever started the
    server, or they cannot log in.

    ⚠️ There is deliberately NO fallback constant. Upstream shipped `admin`, and
    `install.sh` covers itself by generating one into its EnvironmentFile — but
    Docker, `pip install` and source checkouts never set the variable, so every
    one of those installs came up with a well-known password on a server that
    binds 0.0.0.0. A published product cannot ship that: mass scanners find a
    new host within hours, and the admin account owns the whole library, every
    user account and the instance backup.

    Read from the environment rather than a command line flag on purpose:
    process arguments are world-readable via ``/proc/<pid>/cmdline``, whereas
    the environment of a process is only readable by its owner (and root).

    Whitespace is stripped because the value usually arrives through a systemd
    ``EnvironmentFile``, where a trailing newline is easy to introduce and would
    otherwise silently produce a password nobody can type.
    """
    if env is None:
        env = os.environ

    configured = env.get(ADMIN_PASSWORD_ENV, "").strip()

    if configured:
        return configured, False

    return secrets.token_urlsafe(GENERATED_PASSWORD_BYTES), True
