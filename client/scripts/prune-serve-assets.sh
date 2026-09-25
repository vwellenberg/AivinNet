#!/usr/bin/env bash
#
# Delete hashed asset files the live serve directory keeps after they stopped
# being part of the build.
#
# Every deploy writes ~130 newly hashed files and leaves the previous ~130 in
# place, so the directory grows without bound. It lived inside
# deploy-client.sh, where it could not be tested — and it deletes files from
# the directory the running app serves, which is the last place to find out
# that a condition was wrong. Hence its own script, with tests
# (tests/test_prune_serve_assets.py).
#
#   prune-serve-assets.sh <serve/assets> <dist/assets> [grace-minutes]
#
# Two conditions, both required: the file is NOT part of the current build, AND
# it has not been touched for the grace window. Deleting purely by "not in the
# build" would pull the rug from under a tab still running the previous
# version, which lazy-loads its routes as the user clicks.
#
# ⚠️ The window is MINUTES, not days. It used to be 7 days, on the reasoning
# that a week generously covers a tab left open across a deploy. It does — but
# the unit was wrong for the deploy rate: this client is deployed several times
# a day, so "7 days" kept about twenty builds. Measured 2026-09-25: 1776 files
# (57 MB) against 116 in the build (2.4 MB), none of them old enough to prune.
# Nothing was broken; the policy just never expired anything.

set -euo pipefail

SERVE_ASSETS="${1:?usage: prune-serve-assets.sh <serve/assets> <dist/assets> [grace-minutes]}"
DIST_ASSETS="${2:?usage: prune-serve-assets.sh <serve/assets> <dist/assets> [grace-minutes]}"
GRACE_MINUTES="${3:-1440}" # a day: longer than any tab that matters, shorter than a deploy cycle

if [[ ! -d "$SERVE_ASSETS" || ! -d "$DIST_ASSETS" ]]; then
	echo "PRUNE_SKIPPED (no assets directory: $SERVE_ASSETS or $DIST_ASSETS)"
	exit 0
fi

# Refuse to run against a build directory that came out empty: every file in
# the serve directory would count as an orphan, and the app would be gone.
if [[ -z "$(ls -A "$DIST_ASSETS")" ]]; then
	echo "PRUNE_SKIPPED (the build has no assets — refusing to treat everything as an orphan)" >&2
	exit 0
fi

pruned=0
kept=0

# Vite names every asset <name>.<hash>.<ext>, so there is nothing here that
# `ls` handles worse than `find` — and `comm` needs two sorted lists of bare
# names, which `ls -1 | sort` gives directly.
# shellcheck disable=SC2012
while IFS= read -r name; do
	file="$SERVE_ASSETS/$name"
	# -mmin +N is "last modified more than N minutes ago"; the deploy's copy
	# refreshes every file that is still current, so age here means "missed
	# the last N minutes of deploys".
	if [[ -n "$(find "$file" -maxdepth 0 -mmin "+$GRACE_MINUTES" 2>/dev/null)" ]]; then
		rm -f "$file"
		pruned=$((pruned + 1))
	else
		kept=$((kept + 1))
	fi
done < <(comm -23 <(ls -1 "$SERVE_ASSETS" | sort) <(ls -1 "$DIST_ASSETS" | sort))

echo "PRUNED $pruned orphaned asset(s) older than ${GRACE_MINUTES}min; $kept still within the grace window"
