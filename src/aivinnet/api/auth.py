import datetime as dt
import random
import sqlite3
import string
from functools import wraps
from typing import Any

from flask import current_app, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    current_user,
    get_jwt_identity,
    jwt_required,
    set_access_cookies,
)
from flask_openapi3 import APIBlueprint, Tag
from flask_openapi3 import FileStorage as _FileStorage
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, GetCoreSchemaHandler
from pydantic_core import core_schema

from aivinnet.config import UserConfig
from aivinnet.db.userdata import UserTable
from aivinnet.lib import loginguard
from aivinnet.settings import Paths
from aivinnet.store.homepage import HomepageStore
from aivinnet.utils.auth import check_password, hash_password

bp_tag = Tag(name="Auth", description="Authentication stuff")
api = APIBlueprint("auth", __name__, url_prefix="/auth", abp_tags=[bp_tag])


def admin_required():
    """
    Decorator to require admin role
    """

    def wrapper(fn):
        @wraps(fn)
        def decorator(*args, **kwargs):
            if "admin" not in current_user["roles"]:
                return {"msg": "Only admins can do that!"}, 403
            return fn(*args, **kwargs)

        return decorator

    return wrapper


def create_new_token(user: dict):
    """
    Create a new token response
    """
    access_token = create_access_token(identity=user)

    # ⚠️ Normalised, because this value is JSON-encoded into the response and
    # flask_jwt_extended's own default for it is a `timedelta` — which
    # `jsonify` cannot serialise, so the login would answer 500. `config_jwt`
    # happens to store an int, so the app never hit it; anyone setting the
    # config the documented way (a timedelta) would have.
    max_age = current_app.config.get("JWT_ACCESS_TOKEN_EXPIRES")

    if isinstance(max_age, dt.timedelta):
        max_age = int(max_age.total_seconds())

    return {
        "msg": f"Logged in as {user['username']}",
        "accesstoken": access_token,
        "refreshtoken": create_refresh_token(identity=user),
        "maxage": max_age,
    }


class FileStorage(_FileStorage):
    @classmethod
    def __get_pydantic_core_schema__(cls, _source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_plain_validator_function(cls.validate)


def save_user_image(image: FileStorage, userid: int) -> str:
    """
    Save a user's profile image as a square `.webp` and return the filename.

    The image is centre-cropped to a square and capped at 512px since avatars
    are only ever shown small; the filename embeds the user id plus a random
    suffix so replacing an avatar busts any client-side cache.
    """
    img = Image.open(image)

    # Normalise exotic modes (P, CMYK, L, …) so webp encoding never fails.
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")

    width, height = img.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    img = img.crop((left, top, left + side, top + side))
    img.thumbnail((512, 512), Image.Resampling.LANCZOS)

    random_str = "".join(random.choices(string.ascii_letters + string.digits, k=5))
    filename = f"{userid}{random_str}.webp"
    img.save(Paths().user_img_path / filename, "webp")

    return filename


def delete_user_image_file(filename: str) -> None:
    """
    Remove a stored profile image from disk (no-op if empty/missing). Keeps the
    images/users dir from accumulating orphans when an avatar is replaced or
    cleared — mirrors the playlist cover cleanup.
    """
    if not filename:
        return

    try:
        (Paths().user_img_path / filename).unlink(missing_ok=True)
    except OSError:
        pass


class LoginBody(BaseModel):
    # ⚠️ Bounded because the brute-force guard REMEMBERS this string until the
    # account's window expires, and the app sets no MAX_CONTENT_LENGTH. Without a
    # limit, a few thousand requests carrying megabyte-long usernames would pin
    # gigabytes for the life of the process — retention this endpoint did not
    # have before the guard existed. 64 is far above any real name.
    username: str = Field(max_length=64, description="The username", example="user0")
    password: str = Field(description="The password", example="password0")


@api.post("/login")
def login(body: LoginBody):
    """
    Authenticate using username and password
    """
    # Refuse outright while an account is locked out or already has an attempt in
    # flight — never delay the answer. bjoern serves one request at a time, so
    # sleeping here would freeze the app for everyone else (see lib/loginguard.py).
    wait = loginguard.begin_attempt(body.username)
    if wait > 0:
        return {"msg": f"Too many failed attempts. Try again in {round(wait)} seconds."}, 429

    # From here the slot is held, and `finish_attempt` must run on EVERY path —
    # an early return or a raising password check would otherwise leave the
    # account marked busy and lock its owner out until a restart.
    success = False
    try:
        user = UserTable.get_by_username(body.username)

        if user is None:
            # Counted as well: without this, guessing usernames is unlimited, and
            # the 404-vs-401 split already tells an attacker which ones exist.
            return {"msg": "User not found"}, 404

        if not check_password(body.password, user.password):
            return {"msg": "Hehe! invalid password"}, 401

        success = True
        # `todict()` deliberately omits the counter (it is internal, and that
        # method is what `/auth/user` returns), so it is added to the IDENTITY
        # here. From there it rides along in the token and round-trips through
        # `/auth/refresh` and the pair-code flow, both of which re-mint from
        # `get_jwt_identity()`.
        res = create_new_token({**user.todict(), "token_version": user.token_version})
        token = res["accesstoken"]
        age = res["maxage"]
        res = jsonify(res)
        set_access_cookies(res, token, max_age=age)

        return res
    finally:
        loginguard.finish_attempt(body.username, success)


pair_token = dict()


@api.get("/getpaircode")
def get_pair():
    """
    Get a new pair code to log in to thee Swing Music mobile app
    """
    # INFO: if user is already logged in, create a new pair code
    token = create_new_token(get_jwt_identity())
    key = token["accesstoken"][-6:]

    global pair_token
    pair_token = {
        key: token,
    }

    return {"code": key}


class PairDeviceQuery(BaseModel):
    code: str = Field("", description="The code")
    setcookie: bool = Field(False, description="Also set auth cookies on the response (for browser pairing)")


@api.get("/pair")
@jwt_required(optional=True)
def pair_with_code(query: PairDeviceQuery):
    """
    Get an access token by sending a pair code. NOTE: A code can only be used once!
    """
    global pair_token
    token = pair_token.get(query.code)

    if token:
        pair_token = {}

        if query.setcookie:
            # QR deep-link / browser pairing: mirror the login handler so the
            # browser session is logged in via cookies. Same helper, same
            # access token, same max_age as POST /auth/login.
            res = jsonify(token)
            set_access_cookies(res, token["accesstoken"], max_age=token["maxage"])
            return res

        return token

    return {"msg": "Invalid code"}, 400


@api.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    """
    Refresh an access token by sending a refresh token in the Authorization header

    >>> Headers:
    >>> Authorization: Bearer <refresh_token>

    Won't work with cookies!!!
    """
    user = get_jwt_identity()
    return create_new_token(user)


class UpdateProfileBody(BaseModel):
    id: int = Field(0, description="The user id")
    email: str = Field("", description="The email")
    username: str = Field("", description="The username", example="user0")
    password: str = Field("", description="The password", example="password0")
    roles: list[str] = Field(None, description="The roles")


@api.put("/profile/update")
def update_profile(body: UpdateProfileBody):
    """
    Update user profile
    """
    user = {
        "id": body.id,
        "username": body.username,
        "password": body.password,
        "roles": body.roles,
    }

    # prevent updating guest
    if current_user["username"] == "guest" or user["username"] == "guest":
        return {"msg": "Cannot update guest user"}, 400

    # if not id, update self
    if not user["id"]:
        user["id"] = current_user["id"]

    # ...but an id in the body means "update THAT user", and only an admin may say
    # so. Without this check the endpoint is a complete privilege escalation: the
    # roles branch below is skipped whenever `roles` is absent (it defaults to
    # None), so `{"id": <admin>, "password": "..."}` from any logged-in account
    # rewrites the admin's password and every other guard in the app becomes
    # decorative. Self-updates keep working — that is what the profile screen sends.
    if user["id"] != current_user["id"] and "admin" not in current_user["roles"]:
        return {"msg": "Cannot update another user"}, 403

    if body.roles is not None:
        # only admins can update roles
        if "admin" not in current_user["roles"]:
            return {"msg": "Only admins can update roles"}, 403

        all_users = list(UserTable.get_all())
        if "admin" not in body.roles:
            # check if we're removing the last admin
            admins = [user for user in all_users if "admin" in user.roles]

            if len(admins) == 1 and admins[0].id == user["id"]:
                return {"msg": "Cannot remove the only admin"}, 400

        # guest roles cannot be updated
        _user = next(u for u in all_users if u.id == user["id"])
        if "guest" in _user.roles:
            return {"msg": "Cannot update guest user"}, 400

    if user["password"]:
        user["password"] = hash_password(user["password"])

    # remove empty values
    clean_user = {k: v for k, v in user.items() if v}

    # finally, convert roles to json string
    # doing it here to prevent deleting roles from clean user
    # when body.roles is an empty list
    if body.roles is not None:
        clean_user["roles"] = body.roles

    password_changed = bool(user["password"])

    try:
        # return authdb.update_user(clean_user)
        UserTable.update_one(clean_user)
    except sqlite3.IntegrityError:
        return {"msg": "Username already exists"}, 400

    if not password_changed:
        return UserTable.get_by_id(user["id"]).todict()

    # A new password has to end the sessions the old one opened — otherwise
    # "change your password" does nothing for the case people change it FOR:
    # someone else has a token. This also covers an admin resetting another
    # account, which should log that account out everywhere.
    UserTable.bump_token_version(user["id"])
    updated = UserTable.get_by_id(user["id"])

    if user["id"] != current_user["id"]:
        return updated.todict()

    # ⚠️ Changing your own password would otherwise log YOU out one request
    # later — the token you are holding now carries the old version, and every
    # guard in the app would reject it. That reads as a broken app, not as
    # security, so the caller is handed a fresh one in the same response. Other
    # devices stay revoked, which is the point.
    #
    # Both ways, because the two kinds of client differ: the web client
    # authenticates with the cookie, the mobile app and scripts with an
    # `Authorization` header and cannot see a cookie at all. Handing back only
    # the cookie would log the header clients out on the very action this branch
    # exists to keep them signed in through. `POST /auth/login` already returns
    # the token in its body, so the shape is nothing new.
    minted = create_new_token({**updated.todict(), "token_version": updated.token_version})

    res = jsonify({**updated.todict(), "accesstoken": minted["accesstoken"], "maxage": minted["maxage"]})
    set_access_cookies(res, minted["accesstoken"], max_age=minted["maxage"])

    return res


class UpdateAvatarForm(BaseModel):
    image: FileStorage = Field(description="The profile image file")


@api.put("/profile/image")
def update_profile_image(form: UpdateAvatarForm):
    """
    Upload or replace the current user's profile image.

    No JWT refresh is needed: the user_lookup_loader re-reads the user from the
    DB on every request, so GET /auth/user reflects the new image immediately.
    """
    if current_user["username"] == "guest":
        return {"msg": "Cannot update guest user"}, 400

    userid = current_user["id"]
    old_image = current_user["image"]

    try:
        filename = save_user_image(form.image, userid)
    except UnidentifiedImageError:
        return {"error": "Failed: Invalid image"}, 400

    UserTable.update_one({"id": userid, "image": filename})

    # drop the previous file so replacements don't pile up orphans
    if old_image and old_image != filename:
        delete_user_image_file(old_image)

    return UserTable.get_by_id(userid).todict()


@api.delete("/profile/image")
def delete_profile_image():
    """
    Remove the current user's profile image (revert to the generated avatar).
    """
    if current_user["username"] == "guest":
        return {"msg": "Cannot update guest user"}, 400

    userid = current_user["id"]
    old_image = current_user["image"]

    UserTable.update_one({"id": userid, "image": ""})
    delete_user_image_file(old_image)

    return UserTable.get_by_id(userid).todict()


@api.post("/profile/create")
@admin_required()
def create_user(body: UpdateProfileBody):
    """
    Create a new user
    """
    if not body.username or not body.password:
        return {"msg": "Username and password are required"}, 400

    user = {
        "username": body.username,
        "password": hash_password(body.password),
        "roles": [],
    }

    # check if user already exists
    if UserTable.get_by_username(user["username"]):
        return {"msg": "Username already exists"}, 400

    UserTable.insert_one(user)
    user = UserTable.get_by_username(user["username"])

    if user:
        HomepageStore.entries["recently_played"].add_new_user(user.id)
        return user.todict()

    return {
        "msg": "Failed to create user",
    }, 500


@api.post("/profile/guest/create")
@admin_required()
def create_guest_user():
    """
    Create a guest user
    """
    # check if guest user already exists
    guest_user = UserTable.get_by_username("guest")

    if guest_user:
        return {
            "msg": "Guest user already exists",
        }, 400

    UserTable.insert_guest_user()
    user = UserTable.get_by_username("guest")

    if user:
        HomepageStore.entries["recently_played"].add_new_user(user.id)

        return {
            "msg": "Guest user created",
        }

    return {
        "msg": "Failed to create guest user",
    }, 500


class DeleteUseBody(BaseModel):
    # Required, not defaulted: deletion happens BY USERNAME, so an empty one
    # matched nobody and the handler still answered 200 "User  deleted". A
    # request that names no user is a malformed request, not a no-op.
    username: str = Field(..., min_length=1, description="The username")


@api.delete("/profile/delete")
@admin_required()
def delete_user(body: DeleteUseBody):
    """
    Delete a user by username
    """
    # prevent admin from deleting themselves
    if body.username == current_user["username"]:
        return {"msg": "Sorry! you cannot delete yourself"}, 400

    users = list(UserTable.get_all())

    # A delete that matched nothing is not a success. Checked here, before the
    # statement runs, so the answer describes what actually happened.
    if not any(user.username == body.username for user in users):
        return {"msg": f"No user named {body.username}"}, 404

    # prevent deleting the only admin
    admins = [user for user in users if "admin" in user.roles]
    if len(admins) == 1 and admins[0].username == body.username:
        return {"msg": "Cannot delete the only admin"}, 400

    UserTable.remove_by_username(body.username)
    return {"msg": f"User {body.username} deleted"}


@api.get("/logout")
@jwt_required(optional=True)
def logout():
    """
    Log out: clear the cookie AND end every session this account has open.
    """
    # Deleting the cookie only ever cleaned up the browser in front of us. The
    # token itself stayed valid for its full 30 days and renewed itself while it
    # was used, so "log out" did not end the session in any sense that mattered
    # to someone who had copied the token. Bumping the counter does.
    #
    # `optional=True` because the route is reachable without a token (the client
    # calls it to clear a stale session): with one we revoke, without one there
    # is simply nothing to revoke, and either way the cookie goes.
    identity = get_jwt_identity()

    if identity:
        UserTable.bump_token_version(identity["id"])

    res = jsonify({"msg": "Logged out"})
    res.delete_cookie("access_token_cookie")
    return res


class GetAllUsersQuery(BaseModel):
    simplified: bool = Field(False, description="Whether to return simplified user data")


@api.get("/users")
@jwt_required(optional=True)
def get_all_users(query: GetAllUsersQuery):
    """
    Get all users (if you're an admin, you will also receive accounts settings)
    """
    config = UserConfig()
    settings = {
        "enableGuest": False,
        "usersOnLogin": config.usersOnLogin,
    }

    res = {
        "settings": {},
        "users": [],
    }

    users = [u for u in UserTable.get_all()]
    is_admin = current_user and "admin" in current_user["roles"]
    settings["enableGuest"] = [user for user in users if user.username == "guest"].__len__() > 0

    # if user is admin, also return settings
    if is_admin:
        res = {
            "settings": settings,
        }

    # if is normal user, return empty response
    elif current_user or (not current_user and not settings["usersOnLogin"] and not settings["enableGuest"]):
        return res

    # remove guest user
    # if not settings["enableGuest"]:
    #     users = [user for user in users if user.username != "guest"]

    if not settings["usersOnLogin"]:
        users = [user for user in users if user.username == "guest"]

    # reverse list to show latest users first
    users = reversed(users)
    # bring admins to the front
    users = sorted(users, key=lambda x: "admin" in x.roles, reverse=True)
    # bring current user to index 0
    if current_user:
        users = sorted(
            users,
            key=lambda x: x.username == current_user["username"],
            reverse=True,
        )

    if query.simplified:
        res["users"] = [user.todict_simplified() for user in users]
    else:
        res["users"] = [user.todict() for user in users]

    return res


@api.get("/user")
def get_logged_in_user():
    """
    Get logged in user
    """
    return dict(current_user)
