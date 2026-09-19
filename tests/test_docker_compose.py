"""Guards for the published ``docker-compose.yml``.

People fetch this file straight from ``master`` and run it, so it is part of the
install path, not an example. Two interpolations decide whether that first
``docker compose up -d`` works, and they pull in opposite directions:

* The **music directory** must stay required (``:?``). A relative default would
  make Docker create an empty ``./music`` and the server would come up healthy
  with an empty library and nothing to explain it.
* The **admin password** must stay optional. The app generates a random one when
  the variable is empty (``utils/bootstrap.py``); a ``:?`` here used to refuse
  every copy-and-paste install over a value nobody needs to supply. And it must
  never carry a literal default — that would be a well-known password on a
  server bound to 0.0.0.0, the very thing the generator exists to prevent.
"""

import re
from pathlib import Path

from aivinnet.utils.bootstrap import ADMIN_PASSWORD_ENV, initial_admin_password

COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"


def _interpolation(variable: str) -> str:
    """The `${VARIABLE…}` expression compose substitutes, from the live (uncommented) lines."""
    live = "\n".join(
        line for line in COMPOSE.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")
    )
    matches = re.findall(r"\$\{" + variable + r"(?:[:?\-+][^}]*)?\}", live)

    assert len(matches) == 1, f"expected exactly one ${{{variable}}} in docker-compose.yml, found {matches}"
    return matches[0]


class TestComposeInterpolation:
    def test_music_directory_is_required(self):
        assert _interpolation("AIVINNET_MUSIC_DIR").startswith("${AIVINNET_MUSIC_DIR:?")

    def test_admin_password_does_not_block_the_first_start(self):
        assert "?" not in _interpolation(ADMIN_PASSWORD_ENV)

    def test_admin_password_has_no_literal_default(self):
        # `${VAR:-}` resolves to an empty string; anything after `:-` would be
        # the password of every install that did not set one.
        assert _interpolation(ADMIN_PASSWORD_ENV) in {f"${{{ADMIN_PASSWORD_ENV}}}", f"${{{ADMIN_PASSWORD_ENV}:-}}"}

    def test_the_empty_value_compose_passes_makes_the_app_generate_one(self):
        # What the compose file relies on: `${VAR:-}` hands the container an
        # empty variable, and that must mean "generate", not "empty password".
        password, generated = initial_admin_password({ADMIN_PASSWORD_ENV: ""})

        assert generated is True
        assert len(password) >= 16
