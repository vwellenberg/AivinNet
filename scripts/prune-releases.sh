#!/usr/bin/env bash
# Remove every GitHub release but the newest <keep> published ones.
#
#   bash scripts/prune-releases.sh <owner/repo> <keep> <dry_run: true|false>
#
# Called by the Release workflow (build.yml, after a published "latest" release:
# the user's rule since 2026-11-07 is that a release replaces the one before it)
# and by the button Actions → Prune releases (prune-releases.yml).
#
# Only RELEASES go, their page and files. The git tags stay, so every version can
# still be built from its tag, and the Docker images in ghcr are not touched.
# Drafts always count as old. Needs GH_TOKEN with `contents: write`.
set -euo pipefail

repo=$1 keep=$2 dry_run=$3

if ! printf '%s' "$keep" | grep -Eq '^[1-9][0-9]*$'; then
    echo "::error::keep must be a number of at least 1, got '$keep'" >&2
    exit 1
fi

# Every release as "id<TAB>tag<TAB>draft<TAB>published_at", newest first; drafts
# have no published_at and sort last.
releases=$(gh api --paginate "repos/$repo/releases?per_page=100" \
    --jq '.[] | [.id, .tag_name, .draft, (.published_at // "")] | @tsv' |
    sort -t$'\t' -k4,4r)

kept=0
while IFS=$'\t' read -r id tag draft _published; do
    [ -n "$id" ] || continue
    label=$tag
    # An `if`, not `[ … ] && echo` in a substitution: under `set -e` an
    # assignment takes the substitution's status, and a non-draft would end the run.
    if [ "$draft" = "true" ]; then label="$tag (draft)"; fi
    if [ "$draft" = "false" ] && [ "$kept" -lt "$keep" ]; then
        kept=$((kept + 1))
        echo "keep    $label"
        continue
    fi
    if [ "$dry_run" = "true" ]; then
        echo "would remove $label"
    else
        gh api -X DELETE "repos/$repo/releases/$id" >/dev/null
        echo "removed $label"
    fi
done <<< "$releases"

if [ "$kept" -eq 0 ]; then
    echo "::warning::no published release found to keep"
fi
