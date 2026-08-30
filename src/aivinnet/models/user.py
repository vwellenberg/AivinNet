import json
from dataclasses import asdict, dataclass, field


@dataclass(slots=True)
class User:
    id: int
    image: str
    password: str
    username: str
    roles: list[str]
    extra: dict[str, str] = field(default_factory=dict)

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
            "firstname": self.extra["firstname"] if self.extra else "",
        }
