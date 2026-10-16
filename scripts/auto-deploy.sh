#!/usr/bin/env bash
#
# Pull-based deploy (AivinNet#478). Run every minute by a systemd timer on the
# server (scripts/systemd/), never by GitHub: the server is not reachable from
# the internet, so it fetches the signal itself.
#
# The Deploy workflow (.github/workflows/deploy.yml) puts a new signal commit
# on the branch `deploy` per run; its parent is the commit of master to deploy.
# This script fetches the ref. When the signal is one it has not handled yet,
# it brings the checkout to the parent, builds the client when client/ changed,
# restarts the backend when backend files changed, and checks the result at the
# served bytes, not at a message. A deploy that fails is not retried every
# minute; the next signal (the button again, even for the same commit) is.
#
#   scripts/auto-deploy.sh               one run (what the timer does)
#   scripts/auto-deploy.sh --plan A B    what a deploy from A to B would do
#
# Everything another box or a test needs to change is an environment variable.

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REMOTE="${REMOTE:-origin}"
SERVICE="${SERVICE:-aivinnet}"
PORT="${PORT:-1970}"
STATE="${STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/aivinnet-deploy}"
# uv is not on a systemd unit's PATH by default (it lives in ~/.local/bin).
UV="${UV:-$(command -v uv || echo "$HOME/.local/bin/uv")}"

# git and yarn hang for minutes on a line without working IPv6 (DS-Lite, see
# CLAUDE.md): ask both for IPv4.
GIT_FETCH_FLAGS="${GIT_FETCH_FLAGS:---ipv4}"
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"

# The steps, each a shell command run from the checkout's root.
CLIENT_INSTALL="${CLIENT_INSTALL:-cd client && yarn install --frozen-lockfile}"
CLIENT_DEPLOY="${CLIENT_DEPLOY:-bash client/scripts/deploy-client.sh}"
BACKEND_SYNC="${BACKEND_SYNC:-"$UV" sync --frozen}"
# Without `.service`: the sudoers rule names the unit exactly (client/CLAUDE.md).
RESTART="${RESTART:-sudo systemctl restart $SERVICE}"
HEALTH="${HEALTH:-curl -fsS -o /dev/null http://localhost:$PORT/}"
VERIFY="${VERIFY:-1}"

log() { echo "[deploy] $*"; }

run() {
	log "+ $1"
	(cd "$REPO" && bash -c "$1")
}

# What a deploy from $1 to $2 has to do, one word per line:
#   client-deps   client/package.json or client/yarn.lock changed
#   client        anything under client/ changed: rebuild and copy
#   backend-deps  pyproject.toml or uv.lock changed
#   backend       src/, pyproject.toml or uv.lock changed: restart
# An unknown FROM (nothing deployed yet, the state lost, a commit the checkout
# does not have) means all of it: a restart costs seconds, a process that kept
# running the old code costs a bug report (client/CLAUDE.md, "Backend").
plan() {
	local from="$1" to="$2" files
	if [[ -z "$from" ]] || ! git -C "$REPO" cat-file -e "$from^{commit}" 2>/dev/null; then
		printf '%s\n' client-deps client backend-deps backend
		return 0
	fi
	files=$(git -C "$REPO" diff --name-only "$from" "$to")
	if grep -Eq '^client/(package\.json|yarn\.lock)$' <<<"$files"; then echo client-deps; fi
	if grep -Eq '^client/' <<<"$files"; then echo client; fi
	if grep -Eq '^(pyproject\.toml|uv\.lock)$' <<<"$files"; then echo backend-deps; fi
	if grep -Eq '^(src/|pyproject\.toml$|uv\.lock$)' <<<"$files"; then echo backend; fi
	return 0
}

wait_up() {
	local i
	for i in $(seq 1 60); do
		if bash -c "$HEALTH" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	log "the backend does not answer after the restart (tried ${i}s: $HEALTH)"
	return 1
}

# The served bytes, not the build's word for it: the entry script the server
# hands out must be the one this build produced (client/CLAUDE.md, "Gegenprobe").
verify() {
	local built served
	if [[ ! -f "$REPO/client/dist/index.html" ]]; then
		log "no client build to compare against — skipping the served-bytes check"
		return 0
	fi
	built=$(grep -oE 'assets/index[A-Za-z0-9._-]*\.js' "$REPO/client/dist/index.html" | head -1)
	served=$(curl -fsS "http://localhost:$PORT/" | grep -oE 'assets/index[A-Za-z0-9._-]*\.js' | head -1 || true)
	if [[ -z "$built" || "$built" != "$served" ]]; then
		log "the server hands out '${served:-nothing}', the build is '${built:-nothing}'"
		return 1
	fi
	log "served entry: $served"
}

deploy() {
	local from="$1" to="$2" steps
	cd "$REPO"

	# The workflow only ever points `deploy` at master; check it here too, the
	# server should not trust a ref it did not set.
	if ! git merge-base --is-ancestor "$to" "$REMOTE/master"; then
		log "$to is not on $REMOTE/master — refusing"
		return 1
	fi
	# Local edits or local commits are somebody's work: never overwrite them.
	if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
		log "the checkout has uncommitted changes — refusing"
		return 1
	fi
	if git rev-parse --verify -q master >/dev/null && [[ "$(git rev-list --count "$REMOTE/master..master")" != 0 ]]; then
		log "local master has commits that are not on $REMOTE/master — refusing"
		return 1
	fi

	# Exactly the commit the signal names, forward or back (a rollback is a
	# deploy of an older commit). Local master holds nothing of its own (above).
	git checkout -q -B master "$to"

	steps=$(plan "$from" "$to")
	log "steps: $(tr '\n' ' ' <<<"$steps")"

	if grep -qx client-deps <<<"$steps"; then run "$CLIENT_INSTALL" || return 1; fi
	if grep -qx client <<<"$steps"; then run "$CLIENT_DEPLOY" || return 1; fi
	if grep -qx backend-deps <<<"$steps"; then run "$BACKEND_SYNC" || return 1; fi
	if grep -qx backend <<<"$steps"; then
		run "$RESTART" || return 1
		wait_up || return 1
	fi
	if [[ "$VERIFY" == 1 ]]; then
		verify || return 1
	fi
	return 0
}

# The commit a signal asks for: its parent (the workflow's signal commit), or
# the signal itself if it already is a commit of master (a ref set by hand).
target_of() {
	local signal="$1"
	if git -C "$REPO" merge-base --is-ancestor "$signal" "$REMOTE/master"; then
		echo "$signal"
	else
		git -C "$REPO" rev-parse "$signal^1"
	fi
}

main() {
	local signal target deployed handled fetch_flags
	mkdir -p "$STATE"

	exec 9>"$STATE/lock"
	if ! flock -n 9; then
		log "another deploy is still running"
		return 0
	fi

	read -ra fetch_flags <<<"$GIT_FETCH_FLAGS"
	# Quiet when there is nothing to do: this runs every minute.
	if ! timeout 60 git -C "$REPO" fetch --quiet "${fetch_flags[@]}" "$REMOTE" \
		"+refs/heads/master:refs/remotes/$REMOTE/master" \
		"+refs/heads/deploy:refs/remotes/$REMOTE/deploy" 2>"$STATE/fetch.err"; then
		# No `deploy` branch is the normal state before the first button press.
		if grep -q "couldn't find remote ref" "$STATE/fetch.err"; then
			return 0
		fi
		log "fetch failed: $(tr '\n' ' ' <"$STATE/fetch.err")"
		return 1
	fi

	signal=$(git -C "$REPO" rev-parse "$REMOTE/deploy")
	handled=$(cat "$STATE/signal" 2>/dev/null || true)
	if [[ "$signal" == "$handled" ]]; then
		return 0
	fi
	# Handled from here on, whatever the outcome: a failing deploy must not be
	# retried every minute.
	echo "$signal" >"$STATE/signal"

	target=$(target_of "$signal")
	deployed=$(cat "$STATE/deployed" 2>/dev/null || true)
	log "deploying $target (deployed: ${deployed:-nothing yet})"
	if deploy "$deployed" "$target"; then
		echo "$target" >"$STATE/deployed"
		log "DEPLOYED $target"
	else
		log "FAILED $target — not retried until the next signal (run the Deploy workflow again)"
		return 1
	fi
}

if [[ "${1:-}" == --plan ]]; then
	# FROM may be empty: "nothing deployed yet".
	plan "${2-}" "${3:?--plan FROM TO}"
	exit 0
fi

main
