import json
from dataclasses import asdict, dataclass, field
from typing import Any

# The key of `extra` that holds the user's Home layout (#532). The server's own:
# `/nothome` reads it, and `todict()` leaves it out, or it would ride along in
# every token and every `/auth/user*` answer — and go stale there on the next
# save.
HOME_LAYOUT_KEY = "home_layout"
# The Rewind years the user has seen to the end (#572), the same way.
REWIND_SEEN_KEY = "rewind_seen"
PRIVATE_EXTRA_KEYS = frozenset({HOME_LAYOUT_KEY, REWIND_SEEN_KEY})


@dataclass(slots=True)
class User:
    id: int
    image: str
    password: str
    username: str
    roles: list[str]
    extra: dict[str, Any] = field(default_factory=dict)

    # NOTE: roles: ['admin', 'user', 'curator']
    roles: list[str] = field(default_factory=lambda: ["user"])

    # Bumped to end every session that was opened before it. Kept OUT of
    # `todict()` below, next to the password: it is an internal counter, and
    # `todict()` is what `/auth/user` and `/auth/users` return.
    token_version: int = 0

    def todict(self):
        this_dict = asdict(self)
        del this_dict["password"]
        del this_dict["token_version"]
        extra = this_dict["extra"]
        this_dict["extra"] = (
            {k: v for k, v in extra.items() if k not in PRIVATE_EXTRA_KEYS} if isinstance(extra, dict) else {}
        )

        if type(this_dict["roles"]) is str:
            # INFO: this is an attempt to fix string roles!
            try:
                this_dict["roles"] = json.loads(this_dict["roles"])
            except json.JSONDecodeError:
                this_dict["roles"] = []

        return this_dict

    def todict_simplified(self):
        return {
            "id": self.id,
            "username": self.username,
            # `extra` holds more than the first name (the Home layout, #532):
            # a filled `extra` is no promise of one.
            "firstname": (self.extra or {}).get("firstname", ""),
        }
