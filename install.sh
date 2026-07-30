#!/usr/bin/env bash
#
# AivinNet installer for Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/vwellenberg/AivinNet/master/install.sh | bash
#
# Downloads the release AppImage for this machine's architecture, verifies it
# against the release checksums, installs it under ~/.local, and sets up a
# systemd service that survives reboots. Re-running it updates in place.
#
# Design notes worth keeping:
#   * The AppImage is EXTRACTED, not run as a mounted image, so FUSE/libfuse2
#     never has to be installed (Ubuntu 24.04 no longer ships libfuse2).
#   * The admin password is generated and handed over through the environment,
#     never as a command line argument — process arguments are world-readable
#     via /proc/<pid>/cmdline.
#   * A user service needs `loginctl enable-linger`, otherwise systemd tears it
#     down at logout and it never comes back at boot.

set -euo pipefail

REPO="vwellenberg/AivinNet"
APP="aivinnet"

SHARE_DIR="${HOME}/.local/share/${APP}"
BIN_PATH="${HOME}/.local/bin/${APP}"
CONF_DIR="${HOME}/.config/${APP}"
ENV_FILE="${CONF_DIR}/${APP}.env"
# The server itself still uses the upstream config directory name.
DATA_DIR="${HOME}/.config/swingmusic"
USER_UNIT_DIR="${HOME}/.config/systemd/user"
SYSTEM_UNIT_PATH="/etc/systemd/system/${APP}.service"

MODE="user"
AUTOSTART=1
ACTION="install"
HOST="0.0.0.0"
PORT="1970"
MUSIC=""
VERSION=""
# Track whether host/port were given explicitly: re-running the installer to
# update must not reset a port the user configured earlier.
HOST_SET=0
PORT_SET=0

# $USER is not set in every context (cron, some minimal shells).
USER_NAME="${USER:-$(id -un)}"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die() {
	printf '\033[1;31m xx\033[0m %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
AivinNet installer

Usage (piped):  curl -fsSL .../install.sh | bash -s -- [options]
Usage (local):  ./install.sh [options]

Options:
  --system            Install a system-wide service (uses sudo for the unit
                      file only). Starts before anyone logs in — pick this for
                      an always-on server.
  --no-autostart      Install only; do not create or enable a service.
  --port <n>          HTTP port (default: 1970).
  --host <addr>       Bind address (default: 0.0.0.0, reachable on the LAN).
  --music <path>      Music library path. Pre-selects it on a fresh install and
                      makes the service wait for that mount before starting.
  --version <tag>     Install a specific release tag (e.g. v2026.7.0-rc1)
                      instead of the latest one.
  --update            Alias for a plain run: fetches the newest release and
                      replaces the installed copy, keeping your data.
  --uninstall         Remove the service and program files. Your library data
                      in ~/.config/swingmusic is kept.
  -h, --help          This text.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	--system) MODE="system" ;;
	--no-autostart) AUTOSTART=0 ;;
	--update) ACTION="install" ;;
	--uninstall) ACTION="uninstall" ;;
	--port)
		PORT="${2:-}"
		PORT_SET=1
		shift
		;;
	--host)
		HOST="${2:-}"
		HOST_SET=1
		shift
		;;
	--music)
		MUSIC="${2:-}"
		shift
		;;
	--version)
		VERSION="${2:-}"
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*) die "unknown option: $1 (try --help)" ;;
	esac
	shift
done

# ---------------------------------------------------------------- preflight ---

[ "$(uname -s)" = "Linux" ] || die "this installer only supports Linux."

if [ "$(id -u)" -eq 0 ]; then
	die "run this as your normal user, not as root — your library and config
    belong in your home directory. --system uses sudo only for the unit file."
fi

case "$(uname -m)" in
x86_64 | amd64) ARCH="x86_64" ;;
aarch64 | arm64) ARCH="aarch64" ;;
*) die "unsupported architecture: $(uname -m) (releases cover x86_64 and aarch64)." ;;
esac

if command -v curl >/dev/null 2>&1; then
	fetch() { curl -fsSL "$1"; }
	fetch_to() { curl -fsSL -o "$2" "$1"; }
	http_code() { curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || true; }
elif command -v wget >/dev/null 2>&1; then
	fetch() { wget -qO- "$1"; }
	fetch_to() { wget -qO "$2" "$1"; }
	http_code() { wget -q -S -O /dev/null "$1" 2>&1 | awk '/HTTP\//{c=$2} END{print c}' || true; }
else
	die "need curl or wget."
fi

if command -v sha256sum >/dev/null 2>&1; then
	sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
	sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
	sha256() { echo ""; }
fi

HAVE_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
	HAVE_SYSTEMD=1
fi

case "$PORT" in
'' | *[!0-9]*) die "--port must be a number, got: '${PORT}'" ;;
esac

# ------------------------------------------------------------ service verbs ---

unit_installed() {
	[ -f "${USER_UNIT_DIR}/${APP}.service" ] || [ -f "$SYSTEM_UNIT_PATH" ]
}

systemctl_user() { systemctl --user "$@"; }

service_stop_if_running() {
	[ "$HAVE_SYSTEMD" -eq 1 ] || return 0
	if [ -f "${USER_UNIT_DIR}/${APP}.service" ]; then
		systemctl_user stop "${APP}.service" >/dev/null 2>&1 || true
	fi
	if [ -f "$SYSTEM_UNIT_PATH" ]; then
		sudo systemctl stop "${APP}.service" >/dev/null 2>&1 || true
	fi
}

# ------------------------------------------------------------- uninstalling ---

if [ "$ACTION" = "uninstall" ]; then
	log "Removing AivinNet"
	if [ "$HAVE_SYSTEMD" -eq 1 ]; then
		if [ -f "${USER_UNIT_DIR}/${APP}.service" ]; then
			systemctl_user disable --now "${APP}.service" >/dev/null 2>&1 || true
			rm -f "${USER_UNIT_DIR}/${APP}.service"
			systemctl_user daemon-reload || true
		fi
		if [ -f "$SYSTEM_UNIT_PATH" ]; then
			sudo systemctl disable --now "${APP}.service" >/dev/null 2>&1 || true
			sudo rm -f "$SYSTEM_UNIT_PATH"
			sudo systemctl daemon-reload || true
		fi
	fi
	rm -rf "$SHARE_DIR"
	rm -f "$BIN_PATH"
	log "Done. Kept on purpose:"
	printf '      %s   (library, playlists, covers)\n' "$DATA_DIR"
	printf '      %s   (port + admin password)\n' "$ENV_FILE"
	exit 0
fi

# --------------------------------------------------------------- installing ---

if [ -n "$MUSIC" ]; then
	# A quote or backslash would break the hand-written config.json below, so
	# reject those paths instead of mis-escaping them.
	# shellcheck disable=SC1003  # '\' is a literal backslash to match, not an escape.
	case "$MUSIC" in
	*'"'* | *'\'*) die "--music path must not contain quotes or backslashes." ;;
	/*) ;;
	*) die "--music needs an absolute path, got: '${MUSIC}'" ;;
	esac
	[ -d "$MUSIC" ] || warn "music path '${MUSIC}' does not exist (yet). The service will
    wait for it to be mounted before starting."
fi

# A busy port would otherwise surface much later as "the service did not
# answer", which sends people looking in the wrong place. Only checked on a
# first install — on an update the port is busy because WE are listening on it.
if ! unit_installed && command -v ss >/dev/null 2>&1; then
	if ss -ltn 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"; then
		die "port ${PORT} is already in use by something else.
    Pick another one:  --port 1971"
	fi
fi

api="https://api.github.com/repos/${REPO}/releases/latest"
if [ -n "$VERSION" ]; then
	api="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
fi

log "Looking up release (${ARCH})"
release_json="$(fetch "$api")" || die "could not reach the GitHub API. Offline?"

tag="$(printf '%s' "$release_json" | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)"
asset_url="$(printf '%s' "$release_json" |
	grep -o "https://[^\"]*/${APP}-[^\"]*-${ARCH}\.AppImage" | head -n1 || true)"
sums_url="$(printf '%s' "$release_json" |
	grep -o 'https://[^"]*/SHA256SUMS' | head -n1 || true)"

[ -n "$tag" ] || die "no release found at ${api}"
if [ -z "$asset_url" ]; then
	die "release ${tag} has no AppImage for ${ARCH}.
    Available assets are listed at https://github.com/${REPO}/releases"
fi

asset_name="$(basename "$asset_url")"
installed_version=""
if [ -f "${SHARE_DIR}/.version" ]; then
	installed_version="$(cat "${SHARE_DIR}/.version")"
fi
if [ -n "$installed_version" ]; then
	log "Installed: ${installed_version} -> installing ${tag}"
else
	log "Installing ${tag}"
fi

mkdir -p "${HOME}/.cache"
# Deliberately inside $HOME: /tmp is mounted noexec on some hardened systems,
# and the AppImage has to be executed once to unpack itself.
WORK="$(mktemp -d "${HOME}/.cache/${APP}-install.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

log "Downloading ${asset_name}"
fetch_to "$asset_url" "${WORK}/${asset_name}" || die "download failed: ${asset_url}"

if [ -n "$sums_url" ] && [ -n "$(sha256 "${WORK}/${asset_name}")" ]; then
	fetch_to "$sums_url" "${WORK}/SHA256SUMS" || die "could not download SHA256SUMS"
	expected="$(grep -E "[* ]${asset_name}\$" "${WORK}/SHA256SUMS" | awk '{print $1}' | head -n1 || true)"
	[ -n "$expected" ] || die "SHA256SUMS has no entry for ${asset_name}"
	actual="$(sha256 "${WORK}/${asset_name}")"
	[ "$expected" = "$actual" ] || die "checksum mismatch for ${asset_name}
    expected ${expected}
    got      ${actual}"
	log "Checksum verified"
else
	warn "skipping checksum verification (no SHA256SUMS asset or no sha256 tool)"
fi

log "Unpacking"
chmod +x "${WORK}/${asset_name}"
(cd "$WORK" && "./${asset_name}" --appimage-extract >/dev/null) ||
	die "could not unpack the AppImage. Is ${WORK} mounted noexec?"
[ -x "${WORK}/squashfs-root/AppRun" ] || die "unpacked image has no AppRun — corrupt download?"

service_stop_if_running

rm -rf "$SHARE_DIR"
mkdir -p "$(dirname "$SHARE_DIR")"
mv "${WORK}/squashfs-root" "$SHARE_DIR"
printf '%s\n' "$tag" >"${SHARE_DIR}/.version"

mkdir -p "$(dirname "$BIN_PATH")"
cat >"$BIN_PATH" <<EOF
#!/bin/sh
# Wrapper written by the AivinNet installer. AppRun is invoked by its real
# absolute path so the AppImage's own \$APPDIR detection stays correct.
exec "${SHARE_DIR}/AppRun" "\$@"
EOF
chmod +x "$BIN_PATH"

# ------------------------------------------------------------- config + env ---

fresh_install=1
if [ -f "${DATA_DIR}/swingmusic.db" ]; then
	fresh_install=0
fi

generate_password() {
	# `head -c` on /dev/urandom reads a finite amount, so no SIGPIPE surprises
	# under `set -o pipefail`.
	head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

mkdir -p "$CONF_DIR"
new_password=""
if [ ! -f "$ENV_FILE" ]; then
	new_password="$(generate_password)"
	(
		umask 077
		cat >"$ENV_FILE" <<EOF
# AivinNet service configuration. Edit, then:
#   systemctl --user restart ${APP}      (or: sudo systemctl restart ${APP})
HOST=${HOST}
PORT=${PORT}

# Password for the 'admin' account. Only applied when the database is created
# on the very first start — changing it here later has no effect, use the app.
AIVINNET_ADMIN_PASSWORD=${new_password}
EOF
	)
	chmod 600 "$ENV_FILE"
else
	# Keep the existing password AND the existing host/port — an update run must
	# not silently reset a port the user configured. Only explicit flags win.
	if [ "$HOST_SET" -eq 1 ]; then
		if grep -q '^HOST=' "$ENV_FILE"; then
			sed -i "s|^HOST=.*|HOST=${HOST}|" "$ENV_FILE"
		else
			printf 'HOST=%s\n' "$HOST" >>"$ENV_FILE"
		fi
	fi
	if [ "$PORT_SET" -eq 1 ]; then
		if grep -q '^PORT=' "$ENV_FILE"; then
			sed -i "s|^PORT=.*|PORT=${PORT}|" "$ENV_FILE"
		else
			printf 'PORT=%s\n' "$PORT" >>"$ENV_FILE"
		fi
	fi
	# Report and verify against what the service will actually use.
	HOST="$(awk -F= '/^HOST=/{print $2; exit}' "$ENV_FILE")"
	PORT="$(awk -F= '/^PORT=/{print $2; exit}' "$ENV_FILE")"
	[ -n "$HOST" ] || HOST="0.0.0.0"
	[ -n "$PORT" ] || PORT="1970"
fi

if [ -n "$MUSIC" ]; then
	if [ -f "${DATA_DIR}/config.json" ]; then
		warn "existing config found — leaving the library folders alone.
    Add '${MUSIC}' in Settings if it is not there yet."
	else
		mkdir -p "$DATA_DIR"
		printf '{\n    "rootDirs": [\n        "%s"\n    ]\n}\n' "$MUSIC" >"${DATA_DIR}/config.json"
		log "Pre-selected music folder: ${MUSIC}"
	fi
fi

# ----------------------------------------------------------------- service ----

mount_block=""
if [ -n "$MUSIC" ]; then
	# INFO: Without this the service can start before an external music mount is
	# ready. The library scan then finds no files and REMOVES the missing tracks
	# from the database, leaving playlists full of orphaned entries.
	mount_block="# Wait for the music mount before starting (protects the library
# from being wiped by a scan against an empty mount point).
RequiresMountsFor=${MUSIC}"
fi

write_unit() {
	# $1 = extra [Service] lines (system mode needs User=), $2 = WantedBy target
	cat <<EOF
[Unit]
Description=AivinNet music server
Documentation=https://github.com/${REPO}
Wants=network-online.target
After=network-online.target
${mount_block}

[Service]
Type=simple
${1}
EnvironmentFile=${ENV_FILE}
ExecStart=${BIN_PATH} --host \${HOST} --port \${PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=${2}
EOF
}

service_ready=0
if [ "$AUTOSTART" -eq 0 ]; then
	log "Skipping service setup (--no-autostart)"
elif [ "$HAVE_SYSTEMD" -eq 0 ]; then
	warn "no systemd found — skipping autostart. Start it manually: ${BIN_PATH}"
elif [ "$MODE" = "system" ]; then
	log "Installing system service (sudo)"
	write_unit "User=${USER_NAME}" "multi-user.target" | sudo tee "$SYSTEM_UNIT_PATH" >/dev/null
	sudo systemctl daemon-reload
	sudo systemctl enable --now "${APP}.service"
	service_ready=1
else
	log "Installing user service"
	mkdir -p "$USER_UNIT_DIR"
	write_unit "" "default.target" >"${USER_UNIT_DIR}/${APP}.service"
	systemctl_user daemon-reload
	systemctl_user enable --now "${APP}.service"
	service_ready=1

	# Without lingering, the user manager is killed on logout and nothing
	# starts at boot — which is exactly what "runs on my server" needs.
	if ! loginctl show-user "$USER_NAME" 2>/dev/null | grep -q 'Linger=yes'; then
		if ! loginctl enable-linger "$USER_NAME" >/dev/null 2>&1; then
			warn "could not enable lingering automatically. Run this once, or the
    service will stop when you log out and will NOT start at boot:
        sudo loginctl enable-linger ${USER_NAME}"
		fi
	fi
fi

# ------------------------------------------------------------------ verify ----

lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$lan_ip" ] || lan_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{print $7; exit}')"
[ -n "$lan_ip" ] || lan_ip="localhost"
url="http://${lan_ip}:${PORT}"

if [ "$service_ready" -eq 1 ]; then
	log "Waiting for the server to answer"
	ok=0
	for _ in $(seq 1 60); do
		code="$(http_code "http://127.0.0.1:${PORT}/")"
		case "$code" in
		200 | 30? | 40?)
			ok=1
			break
			;;
		esac
		sleep 1
	done

	if [ "$ok" -eq 0 ]; then
		if [ "$MODE" = "system" ]; then
			logs="sudo journalctl -u ${APP} -n 50"
		else
			logs="journalctl --user -u ${APP} -n 50"
		fi
		die "the service did not answer on port ${PORT} within 60s.
    Check the log:  ${logs}"
	fi
fi

printf '\n'
log "AivinNet ${tag} is installed"
printf '\n'
printf '      %s\n' "$url"
if [ "$fresh_install" -eq 1 ] && [ -n "$new_password" ]; then
	printf '      login:    admin / %s\n' "$new_password"
	printf '      (also in %s)\n' "$ENV_FILE"
elif [ "$fresh_install" -eq 1 ]; then
	printf '      login:    admin / (password in %s)\n' "$ENV_FILE"
else
	printf '      login:    unchanged\n'
fi
printf '\n'
if [ "$fresh_install" -eq 1 ] && [ -z "$MUSIC" ]; then
	printf '  Next: log in, then pick your music folder when asked.\n'
	printf '        The first scan takes a while on a large library.\n'
fi
if [ "$service_ready" -eq 1 ]; then
	if [ "$MODE" = "system" ]; then
		printf '  Service: sudo systemctl status|restart|disable %s\n' "$APP"
		printf '  Logs:    sudo journalctl -u %s -f\n' "$APP"
	else
		printf '  Service: systemctl --user status|restart|disable %s\n' "$APP"
		printf '  Logs:    journalctl --user -u %s -f\n' "$APP"
	fi
fi
printf '  Update:  re-run this installer   Remove: ./install.sh --uninstall\n'
printf '  Backup:  %s  is the only copy of your library data.\n' "$DATA_DIR"
printf '\n'
