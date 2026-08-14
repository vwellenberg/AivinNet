from dataclasses import asdict, fields
from typing import Any

from flask_jwt_extended import current_user as jwt_current_user
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.auth import admin_required
from aivinnet.config import UserConfig
from aivinnet.db.userdata import PluginTable
from aivinnet.lib.index import index_everything
from aivinnet.settings import Metadata
from aivinnet.utils.auth import get_current_userid

bp_tag = Tag(name="Settings", description="Customize stuff")
api = APIBlueprint("settings", __name__, url_prefix="/notsettings", abp_tags=[bp_tag])


def get_child_dirs(parent: str, children: list[str]):
    """Returns child directories in a list, given a parent directory"""

    return [_dir for _dir in children if _dir.startswith(parent) and _dir != parent]


class AddRootDirsBody(BaseModel):
    new_dirs: list[str] = Field(
        description="The new directories to add",
        example=["/home/user/Music", "/home/user/Downloads"],
    )
    removed: list[str] = Field(
        description="The directories to remove",
        example=["/home/user/Downloads"],
    )


@api.post("/add-root-dirs")
@admin_required()
def add_root_dirs(body: AddRootDirsBody):
    """
    Add custom root directories to the database.
    """
    new_dirs = body.new_dirs
    removed_dirs = body.removed

    config = UserConfig()
    db_dirs = config.rootDirs
    home = "$home"

    db_home = any([d == home for d in db_dirs])  # if $home is in db
    incoming_home = any([d == home for d in new_dirs])  # if $home is in incoming

    # handle $home case
    if db_home and incoming_home:
        return {"msg": "Not changed!"}, 304

    # if $home is the current root dir or the incoming root dir
    # is $home, remove all root dirs
    if db_home or incoming_home:
        config.rootDirs = []

    if incoming_home:
        config.rootDirs = [home]
        index_everything()
        return {"root_dirs": [home]}

    # ---

    for _dir in new_dirs:
        children = get_child_dirs(_dir, db_dirs)
        removed_dirs.extend(children)

    for _dir in removed_dirs:
        try:
            db_dirs.remove(_dir)
        except ValueError:
            pass

    db_dirs.extend(new_dirs)
    config.rootDirs = [dir_ for dir_ in db_dirs if dir_ != home]

    index_everything()
    return {"root_dirs": config.rootDirs}


# NOTE: deliberately NOT admin-gated. It would not hide anything — `GET /notsettings`
# returns the same `rootDirs` and the client needs them from there — while breaking
# every non-admin session: `App.vue::handleRootDirsPrompt` runs on each mount, reads a
# 403 as "no dirs configured" and puts the first-run modal in front of a guest who
# cannot dismiss it. Exposing the media paths to a logged-in user is a separate,
# smaller question than letting them change the library.
@api.get("/get-root-dirs")
def get_root_dirs():
    """
    Get root directories
    """
    return {"dirs": UserConfig().rootDirs}


@api.get("")
def get_all_settings():
    """
    Get all settings
    """
    config = asdict(UserConfig())

    # Convert sets to lists for JSON serialization
    for key, value in config.items():
        if isinstance(value, set):
            config[key] = sorted(list(value))

    # The serverId is the JWT signing key AND the password salt (see
    # `app_builder.config_app` and `utils.auth.hash_password`). Anyone holding it
    # can mint a token for any user, so it must never leave the server — not even
    # for an admin, who has no use for it in the client.
    del config["serverId"]

    config["plugins"] = [p for p in PluginTable.get_all()]
    config["version"] = Metadata.version

    if config["version"] == "0.0.0":
        # fallback to version.txt (useful for docker builds)
        with open("version.txt") as f:
            config["version"] = f.read().strip()

    # The Last.fm application credentials are server configuration, not something
    # a listener needs. They only ever mattered to the settings row that lets an
    # admin swap in their own key — and that row is the admin's to see.
    if "admin" not in jwt_current_user["roles"]:
        config["lastfmApiKey"] = ""
        config["lastfmApiSecret"] = ""

    # only return lastfmSessionKey for the current user
    current_user = get_current_userid()
    config["lastfmSessionKey"] = config["lastfmSessionKeys"].get(str(current_user), "")
    del config["lastfmSessionKeys"]

    return config


class SetSettingBody(BaseModel):
    key: str = Field(
        description="The setting key",
        example="artist_separators",
    )
    value: Any = Field(
        description="The setting value",
        example=",",
    )


@api.get("/trigger-scan")
@admin_required()
def trigger_scan():
    """
    Triggers scan for new music
    """
    index_everything()
    return {"msg": "Scan triggered!"}


class UpdateConfigBody(BaseModel):
    key: str = Field(
        description="The setting key",
        example="usersOnLogin",
    )
    value: Any = Field(
        description="The setting value",
        example=False,
    )


# Keys the generic setter must never touch. `serverId` signs every token and salts
# every password hash, so overwriting it logs everyone out AND makes every stored
# password wrong at the same moment — with no way back, because the old value is
# gone. It is not a setting; it is the server's identity.
PROTECTED_CONFIG_KEYS = frozenset({"serverId"})


def _writable_config_keys() -> set[str]:
    """The settings the generic setter accepts: declared, public config fields.

    An allow-list rather than a deny-list, because `setattr` takes ANY name — it
    does not have to be a setting at all. `{"key": "write_to_file"}` replaces the
    config's own method on the process-wide singleton, and every later write in the
    running server then raises TypeError until a restart. A name that is merely
    unknown is no better: it silently attaches a dead attribute nobody reads, so the
    request answers 200 and the setting never applies (that is exactly what the
    client's `enableWatchDog` has been doing — the field is `enableWatchdog`).
    """
    return {f.name for f in fields(UserConfig) if not f.name.startswith("_")} - PROTECTED_CONFIG_KEYS


@api.put("/update")
@admin_required()
def update_config(body: UpdateConfigBody):
    """
    Update the config file
    """
    # Refuse before mutating anything (see .claude/rules/api-endpoints.md).
    if body.key not in _writable_config_keys():
        return {"msg": f"'{body.key}' is not a writable setting"}, 400

    config = UserConfig()
    if body.key == "artistSeparators":
        body.value = body.value.split(",")

    setattr(config, body.key, body.value)

    # INFO: Rebuild stores when these settings are updated
    reset_stores_lists = {
        "artistSeparators",
        "artistSplitIgnoreList",
        "removeProdBy",
        "removeRemasterInfo",
        "mergeAlbums",
        "cleanAlbumTitle",
        "showAlbumsAsSingles",
    }

    if body.key in reset_stores_lists:
        index_everything()

    return {
        "msg": "Config updated!",
    }
