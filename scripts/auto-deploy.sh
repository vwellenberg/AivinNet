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
# A deadline on every request: bjoern serves one request at a time, and a
# handler that hangs would hold this run until systemd's own timeout.
HEALTH="${HEALTH:-curl -fsS --max-time 5 -o /dev/null http://localhost:$PORT/}"
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
	built=$(grep -oE 'assets/index[A-Za-z0-9._-]*\.js' "$REPO/client/dist/index.html" | head -1 || true)
	served=$(curl -fsS --max-time 10 "http://localhost:$PORT/" | grep -oE 'assets/index[A-Za-z0-9._-]*\.js' | head -1 || true)
	if [[ -z "$built" || "$built" != "$served" ]]; then
		log "the server hands out '${served:-nothing}', the build is '${built:-nothing}'"
		return 1
	fi
	log "served entry: $served"
}

has() { grep -qx "$1" <<<"$steps"; }

# ⚠️ `deploy` is called as an `if` condition, and bash switches `set -e` off
# inside a function called that way: every step that can fail says so itself
# (`|| return 1`), or a failed checkout would still end in DEPLOYED.
deploy() {
	local from="$1" to="$2" head synced=0
	steps=""
	cd "$REPO" || return 1

	# The workflow only ever points `deploy` at master; check it here too, the
	# server should not trust a ref it did not set.
	if ! git merge-base --is-ancestor "$to" "$REMOTE/master"; then
		log "$to is not on $REMOTE/master — refusing"
		return 1
	fi
	# A commit from before this script existed would delete it, and the timer
	# would fail every minute from then on — on a box nobody can reach from
	# outside. A rollback goes no further back than the deploy button.
	if ! git cat-file -e "$to:scripts/auto-deploy.sh" 2>/dev/null; then
		log "$to has no scripts/auto-deploy.sh (older than the deploy button) — refusing"
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

	# The plan starts from what is on disk. A box someone deployed by hand
	# since (HEAD is not what this script deployed last) gets everything.
	head=$(git rev-parse HEAD) || return 1
	if [[ "$head" != "$from" ]]; then
		from=""
	fi

	# Exactly the commit the signal names, forward or back (a rollback is a
	# deploy of an older commit). Local master holds nothing of its own (above).
	git checkout -q -B master "$to" || return 1
	steps=$(plan "$from" "$to") || { undo "$head" "$synced"; return 1; }
	log "steps: $(tr '\n' ' ' <<<"$steps")"

	# Dependencies first, then the backend, then the client: the client's
	# post-deploy gates (deploy-client.sh) test the new bundle against the
	# backend it is meant for, not against the process that ran before.
	if has backend-deps; then
		run "$BACKEND_SYNC" || { undo "$head" 1; return 1; }
		synced=1
	fi
	if has client-deps; then
		run "$CLIENT_INSTALL" || { undo "$head" "$synced"; return 1; }
	fi
	if has backend; then
		run "$RESTART" || { undo "$head" "$synced"; return 1; }
		# From here on the new code is live: no undo, only a clear report.
		wait_up || { log "the backend was restarted on $to and does not answer"; return 1; }
	fi
	if has client; then
		run "$CLIENT_DEPLOY" || { log "the client build or its gates failed; files may already be live"; return 1; }
	fi
	if [[ "$VERIFY" == 1 ]]; then
		verify || return 1
	fi
	return 0
}

# A deploy that fails before anything went live: put the checkout (and the
# environment, if it was synced) back to what is running, so a reboot does not
# start code that was never deployed against an environment that does not fit.
undo() {
	local head="$1" synced="$2"
	log "undoing: checkout back to $head"
	git -C "$REPO" checkout -q -B master "$head" || log "could not restore the checkout to $head"
	if [[ "$synced" == 1 ]]; then
		run "$BACKEND_SYNC" || log "could not restore the environment for $head"
	fi
}

# The commit a signal asks for: its parent (the workflow's signal commit), or
# the signal itself if it already is a commit of master (a ref set by hand).
target_of() {
	local signal="$1"
	if git -C "$REPO" merge-base --is-ancestor "$signal" "$REMOTE/master"; then
		echo "$signal"
	else
		# Empty for a signal without a parent (a ref pushed by hand).
		git -C "$REPO" rev-parse -q --verify "$signal^1" || true
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
	# `LC_ALL=C`: the message checked below is git's English one, and a German
	# box would translate it.
	if ! LC_ALL=C timeout 60 git -C "$REPO" fetch --quiet "${fetch_flags[@]}" "$REMOTE" \
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
	if [[ -z "$target" ]]; then
		log "the signal $signal names no commit (not from the Deploy workflow) — refusing"
		return 1
	fi
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

# One line: bash reads a script as it runs, and the checkout may just have
# replaced this file under it.
main; exit $?
