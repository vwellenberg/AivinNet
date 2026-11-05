#!/usr/bin/env bash
# Which commit the release workflow hands ncipollo/release-action as `commit`.
#
#   bash scripts/release-target.sh <owner/repo> <tag> <sha being built>
#
# Prints the sha for a release that does not exist yet, and an EMPTY line for
# one that already points at this sha. The action leaves target_commitish out
# of its update when `commit` is empty, and that is the point: the target is
# set once, on create, and never sent again.
#
# Why (measured 2026-11-05, AivinNet#710): GITHUB_TOKEN has no `workflows`
# permission, and GitHub answers 403 "Resource not accessible by integration"
# when it points a release at a commit whose .github/workflows differ from the
# default branch. Creating the release right away works, because the commit
# being built is master. Re-running the upload after a later merge touched a
# workflow, or a merge landing during the ~30 minutes a release takes, made the
# action's update send the same target again, and that was refused: run
# 42082724759, attempt 2.
#
# A release that points at a DIFFERENT commit stops the run. Uploading would
# put new files under the old target (the action never moves a target or a
# tag); the fix is to dispatch from the tag, or to delete the draft.
set -euo pipefail

repo=$1 tag=$2 sha=$3

# Bash does the filtering, not --jq: one fixed expression for every call.
targets=$(gh api "repos/$repo/releases" --paginate --jq '.[] | [.tag_name, .target_commitish] | @tsv' |
    awk -F'\t' -v tag="$tag" '$1 == tag { print $2 }')

if [ -z "$targets" ]; then
    echo "$sha"
    exit 0
fi

if [ "$(printf '%s\n' "$targets" | wc -l)" -gt 1 ]; then
    echo "::error title=Several releases for $tag::More than one release (drafts included) carries the tag $tag. Delete the extra drafts, then run again." >&2
    exit 1
fi

# A published release has a tag, and the tag is what counts: target_commitish
# may name a branch. A draft has no tag yet, so its target is all there is.
# Ask whether the tag exists instead of treating any failed lookup as "no
# tag": a 502 must stop the run, not turn into a wrong comparison.
refs=$(gh api "repos/$repo/git/matching-refs/tags/$tag" --jq '.[] | .ref')
# A here-string, not a pipe: with pipefail, `grep -q` quitting early could
# turn a match into a failed pipeline.
if grep -qxF "refs/tags/$tag" <<<"$refs"; then
    current=$(gh api "repos/$repo/commits/$tag" --jq .sha)
else
    current=$targets
fi

if [ "$current" = "$sha" ]; then
    echo ""
    exit 0
fi

echo "::error title=Release $tag points at another commit::$tag already exists for $current, and this run builds $sha. Run the workflow from the tag (Use workflow from: $tag), or delete the draft release first." >&2
exit 1
