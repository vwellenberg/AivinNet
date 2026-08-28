import datetime as dt
import logging
import pathlib

from flask import Response, request
from flask_compress import Compress
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt,
    get_jwt_identity,
    set_access_cookies,
    verify_jwt_in_request,
)
from flask_openapi3 import Info, OpenAPI

from aivinnet import api as aivinnet_api
from aivinnet.api.plugins import lyrics as lyrics_plugin
from aivinnet.config import UserConfig
from aivinnet.db.userdata import UserTable
from aivinnet.settings import Metadata, Paths
from aivinnet.utils.net import prefer_ipv4
from aivinnet.utils.paths import get_client_files_extensions

log = logging.getLogger(__name__)
# # # # # # # # # # # # # # # # # #
# Grouped configuration function  #
# # # # # # # # # # # # # # # # # #


def config_app(web):
    # OUTBOUND HTTP: IPv6 routing is broken on the deployment host — trying
    # AAAA addresses first blocks outbound requests (and the evented server).
    prefer_ipv4()

    # CORS
    #
    # ⚠️ `supports_credentials` is the half that matters, and NOT because of the
    # origin header. flask-cors echoes the requesting origin into
    # `Access-Control-Allow-Origin` whenever the request carries an `Origin` at
    # all and the origin list matches — the wildcard matches everything, and
    # `supports_credentials` does not enter that branch (get_cors_origins, the
    # `try_match_any` case). Turning it off does not stop the echo, and a test
    # asserting otherwise fails; see tests_api/test_cookie_and_cors_hardening.py.
    #
    # What it does stop is `Access-Control-Allow-Credentials: true`, which is only
    # emitted when the flag is set. That header is the whole attack: without it a
    # browser refuses to attach the session cookie to a cross-origin request and
    # refuses to hand the response of a credentialed one to the calling page. With
    # it — as shipped — any site the owner visited could read and drive the entire
    # API as them, since JWT_COOKIE_CSRF_PROTECT is off.
    #
    # The echo that remains is harmless on its own: such a request arrives with no
    # cookie, so anything requiring auth answers 401. It does expose whatever is
    # already reachable unauthenticated (`/auth/users`, `/docs`, `/img/**`) to
    # cross-origin reads — those are separate defects, fixed separately.
    #
    # The wildcard stays because header-authenticated clients (mobile app,
    # scripts) rely on it and are unaffected by this flag. The web client is
    # served by THIS process, so it is same-origin and never involves CORS.
    CORS(web, origins="*", supports_credentials=False)

    # RESPONSE COMPRESSION
    # Only compress JSON responses
    Compress(web)
    web.config["COMPRESS_MIMETYPES"] = [
        "application/json",
    ]


def config_jwt(web):
    # JWT CONFIGS
    web.config["JWT_VERIFY_SUB"] = False
    web.config["JWT_SECRET_KEY"] = UserConfig().serverId
    web.config["JWT_TOKEN_LOCATION"] = ["cookies", "headers"]
    web.config["JWT_COOKIE_CSRF_PROTECT"] = False

    # Strict, not Lax: under Lax the cookie still rides along on a top-level
    # navigation, and `GET /notsettings/trigger-scan` is a state-changing GET — a
    # link from anywhere would kick off a full library scan. The cost of Strict is
    # that following an external link to the server looks logged out until one
    # reload; for an app people open directly (bookmark, PWA) that is the better
    # trade.
    web.config["JWT_COOKIE_SAMESITE"] = "Strict"

    # ⚠️ Deliberately False, and NOT to be flipped without checking how the
    # instance is reached. The server binds 0.0.0.0 and is normally used over plain
    # http:// on the LAN; with Secure set the browser silently DISCARDS the cookie
    # there. Login still answers 200, so the failure looks like a broken app rather
    # than a configuration error — an endless login loop. Turn it on only once every
    # access path is HTTPS (e.g. everything arrives through `tailscale serve`).
    web.config["JWT_COOKIE_SECURE"] = False

    web.config["JWT_SESSION_COOKIE"] = False

    jwt_expiry = int(dt.timedelta(days=30).total_seconds())
    web.config["JWT_ACCESS_TOKEN_EXPIRES"] = jwt_expiry

    jwt = JWTManager(web)

    @jwt.user_lookup_loader
    def user_lookup_callback(_jwt_header, jwt_data):
        identity = jwt_data["sub"]
        userid = identity["id"]
        user = UserTable.get_by_id(userid)

        if user:
            return user.todict()


def load_endpoints(web: OpenAPI):
    # Register all the API blueprints
    with web.app_context():
        web.register_api(aivinnet_api.album.api)
        web.register_api(aivinnet_api.artist.api)
        web.register_api(aivinnet_api.stream.api)
        web.register_api(aivinnet_api.search.api)
        web.register_api(aivinnet_api.folder.api)
        web.register_api(aivinnet_api.playlist.api)
        web.register_api(aivinnet_api.playlistfolders.api)
        web.register_api(aivinnet_api.favorites.api)
        web.register_api(aivinnet_api.track.api)
        web.register_api(aivinnet_api.imgserver.api)
        web.register_api(aivinnet_api.settings.api)
        web.register_api(aivinnet_api.colors.api)
        web.register_api(aivinnet_api.lyrics.api)
        web.register_api(aivinnet_api.backup_and_restore.api)
        web.register_api(aivinnet_api.download.api)
        web.register_api(aivinnet_api.musicbrainz.api)
        web.register_api(aivinnet_api.coverart.api)

        # Multiroom device sync
        web.register_api(aivinnet_api.devicesync.api)

        # Logger
        web.register_api(aivinnet_api.scrobble.api)

        # Home
        web.register_api(aivinnet_api.home.api)
        web.register_api(aivinnet_api.getall.api)

        # Auth
        web.register_api(aivinnet_api.auth.api)


def load_plugins(web: OpenAPI):
    # TODO: rework plugin support
    # Plugins
    web.register_api(aivinnet_api.plugins.api)
    web.register_api(lyrics_plugin.api)


# # # # # # # # # # #
# Create App object #
# # # # # # # # # # #

api_info = Info(
    title="Swing Music",
    version=f"v{Metadata.version}",
    description="The REST API exposed by your Swing Music server",
)

app = OpenAPI(__name__, info=api_info, doc_prefix="/docs")


def check_auth_need() -> bool:
    """
    Check if the current request is for a static file.
    We do not need auth for index or static images of index.

    :return: True if static file else False
    """

    # INFO: Routes that don't need authentication
    urls = {
        "/auth/login",
        "/auth/users",
        "/auth/pair",
        "/auth/logout",
        "/auth/refresh",
        "/docs",
    }
    files = {".webp", ".jpg", *get_client_files_extensions()}

    urls = tuple(urls)
    files = tuple(files)

    if request.path == "/" or request.path.endswith(files):
        return True

    # if request path starts with any of the blacklisted routes, don't verify jwt
    return bool(request.path.startswith(urls))


# # # # # # # # # # # # #
# global endpoint logic #
# # # # # # # # # # # # #


@app.route("/<path:path>")
def serve_client_files(path: str):
    """
    Serves the static files in the client folder.
    """

    # TODO: rule out possible double /client path.
    # path sometimes prepended with /client like '/client/some.js' resolves to '/client/client/some.js'

    js_or_css = path.endswith(".js") or path.endswith(".css")

    if not js_or_css:
        return app.send_static_file(path)

    # INFO: Safari doesn't support gzip encoding
    # See issue: https://github.com/swingmx/swingmusic/issues/155
    user_agent = request.headers.get("User-Agent", "")
    if "Safari" in user_agent and "Chrome" not in user_agent:
        return app.send_static_file(path)

    if "gzip" in request.headers.get("Accept-Encoding", ""):
        gz_name = path + ".gz"
        gzipped_path = pathlib.Path(app.static_folder or "") / gz_name

        if gzipped_path.exists():
            response = app.make_response(app.send_static_file(gz_name))
            response.headers["Content-Encoding"] = "gzip"
            return response

    return app.send_static_file(path)


@app.route("/")
def serve_client():
    """
    Serves the index.html file at `client/index.html`.
    """
    return app.send_static_file("index.html")


def build() -> OpenAPI:
    """
    Call this function to obtain the final flask/openapi object.

    Do not import app directly as the static_folder can only be set
    when cli args are parsed.

    :return: OpenApi object with all config set
    """

    # set late state config
    app.static_folder = Paths().client_path

    @app.before_request
    def verify_auth():
        """
        Verifies the JWT token before each request.
        """

        if check_auth_need():
            return

        verify_jwt_in_request()

    @app.after_request
    def refresh_expiring_jwt(response: Response):
        """
        Refreshes the cookies JWT token after each request.
        """

        # INFO: If the request has an Authorization header, don't refresh the jwt
        # Request is probably from the mobile client or a third party
        if check_auth_need() or request.headers.get("Authorization"):
            return response

        try:
            exp_timestamp = get_jwt()["exp"]
            until = dt.datetime.now(dt.UTC) + dt.timedelta(days=7)

            if until.timestamp() > exp_timestamp:
                access_token = create_access_token(identity=get_jwt_identity())
                set_access_cookies(response, access_token)

            return response
        except (RuntimeError, KeyError):
            return response

    config_app(app)
    config_jwt(app)
    load_endpoints(app)
    load_plugins(app)

    return app
