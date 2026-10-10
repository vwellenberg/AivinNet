#!/usr/bin/env bash
# Release helper: one command per step, short output. The long logs stay on
# the test host.
#
#   bash scripts/release.sh rc      2026.10.4                 build 2026.10.4-rc1 (prerelease + Docker)
#   bash scripts/release.sh test    2026.10.3 2026.10.4-rc1   update tests on the test host
#   bash scripts/release.sh final   2026.10.4                 build the final release (latest)
#   bash scripts/release.sh cleanup 2026.10.4 [--yes]         old release, rc tags, old images (dry run without --yes)
#   bash scripts/release.sh status                            latest builds and releases
#
# Guards: rc and final need a checkout that equals origin/master. final needs a
# passed `test` of the last rc, and only docs or tests may have changed since
# that rc. cleanup is a dry run unless --yes is given.
#
# The update tests run on a host you control: set AIVINNET_TEST_HOST (user@host)
# and, if needed, AIVINNET_TEST_KEY (ssh key path). The host needs
# ~/uitest/rel_appimage.sh and ~/uitest/rel_docker.sh (see MAINTAINER.local.md).
set -euo pipefail

REPO=vwellenberg/AivinNet
OWNER=${REPO%%/*}
STATE="$(git rev-parse --git-common-dir)/release"   # local, never committed
mkdir -p "$STATE"

die() { echo "❌ $*" >&2; exit 1; }
say() { echo "• $*"; }

need_clean_master() {
    git diff --quiet && git diff --cached --quiet || die "the working tree has changes"
    git fetch -q origin master
    [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || die "HEAD is not origin/master — pull first"
}

# Starts the build workflow and waits for it. Records the start time for cleanup.
dispatch() {  # tag prerelease is_latest
    local tag=$1 pre=$2 latest=$3 start id
    start=$(date -u +%FT%TZ)
    gh workflow run build.yml --repo "$REPO" --ref master \
        -f tag="$tag" -f binary_build=true -f is_draft=false \
        -f prerelease="$pre" -f is_latest="$latest" -f build_docker=true >/dev/null
    sleep 8
    id=$(gh run list --repo "$REPO" --workflow build.yml --limit 1 --json databaseId -q '.[0].databaseId')
    echo "$start" > "$STATE/$tag.start"
    say "build v$tag started (run $id), waiting…"
    gh run watch "$id" --repo "$REPO" --exit-status >/dev/null 2>&1 \
        || die "build failed — gh run view $id --repo $REPO --log-failed | tail -40"
    say "build v$tag finished"
}

# The release is published and carries the installer's checksum file.
check_release() {  # tag
    local info
    info=$(gh release view "v$1" --repo "$REPO" --json assets,isDraft,isPrerelease \
        -q '"\(.assets|length) assets, draft=\(.isDraft), prerelease=\(.isPrerelease), sums=\(any(.assets[]; .name == "SHA256SUMS"))"')
    say "v$1: $info"
    case $info in
        *"draft=false"*"sums=true"*) ;;
        *) die "v$1 is not a complete, published release" ;;
    esac
}

cmd_rc() {  # base, e.g. 2026.10.4
    local base=$1 n=1 tag old
    while [ -n "$(git ls-remote --tags origin "refs/tags/v$base-rc$n")" ]; do n=$((n + 1)); done
    tag="$base-rc$n"
    need_clean_master
    git rev-parse HEAD > "$STATE/$tag.sha"
    dispatch "$tag" true false
    check_release "$tag"
    echo "$tag" > "$STATE/last_rc"
    old=$(gh api "repos/$REPO/releases/latest" -q .tag_name | sed 's/^v//')
    say "next: bash scripts/release.sh test $old $tag"
}

cmd_test() {  # old base, new rc tag
    local old=$1 new=$2 host=${AIVINNET_TEST_HOST:-} key=${AIVINNET_TEST_KEY:-} i
    [ -n "$host" ] || die "set AIVINNET_TEST_HOST=user@host"
    [ -f "$STATE/$new.sha" ] || die "no build record for $new on this machine — build it here first"
    local -a ssh=(ssh -o BatchMode=yes)
    [ -n "$key" ] && ssh+=(-i "$key")
    ssh+=("$host")
    local app="uitest/rel-$new-appimage.log" dock="uitest/rel-$new-docker.log"

    "${ssh[@]}" "rm -f ~/$app ~/$dock; setsid nohup bash -c 'bash ~/uitest/rel_appimage.sh v$old v$new > ~/$app 2>&1; bash ~/uitest/rel_docker.sh v$old v$new > ~/$dock 2>&1; echo ALL_TESTS_DONE >> ~/$dock' >/dev/null 2>&1 </dev/null &"
    say "tests v$old -> v$new started on the test host, waiting…"
    for i in $(seq 1 120); do
        "${ssh[@]}" "grep -q ALL_TESTS_DONE ~/$dock 2>/dev/null" && break
        sleep 30
    done
    "${ssh[@]}" "grep -q ALL_TESTS_DONE ~/$dock" || die "the tests did not finish within an hour"

    "${ssh[@]}" "grep -h -E ' requests, |lines: |stopped cleanly|Traceback|STOP HUNG' ~/$app ~/$dock | tail -12" || true
    if "${ssh[@]}" "a=~/$app; d=~/$dock; grep -q 'ALL DONE' \$a && grep -q 'stopped cleanly' \$a && grep -q ' 0 failed' \$a && grep -q 'lines: 0' \$a && grep -q 'ALL DONE' \$d && grep -q ' 0 failed' \$d && grep -q 'lines: 0' \$d && ! grep -q -E 'Traceback|STOP HUNG' \$a \$d"; then
        cat "$STATE/$new.sha" > "$STATE/$new.passed"
        say "TESTS PASSED for $new — final is allowed now"
    else
        die "tests are not green — full logs on the test host: $app and $dock"
    fi
}

cmd_final() {  # base
    local base=$1 rc rc_sha changed risky
    rc=$(cat "$STATE/last_rc" 2>/dev/null || true)
    case $rc in
        "$base"-rc*) ;;
        *) die "the last rc built here is '${rc:-none}', not $base-rc*" ;;
    esac
    [ -f "$STATE/$rc.passed" ] || die "$rc has not passed: bash scripts/release.sh test <old> $rc"
    need_clean_master
    rc_sha=$(cat "$STATE/$rc.passed")
    changed=$(git diff --name-only "$rc_sha" origin/master)
    risky=$(printf '%s\n' "$changed" \
        | grep -v -E '^(docs/|\.claude/|tests/|tests_api/|\.github/changelog\.md$|scripts/release\.sh$|README\.md$)|__tests__/|\.md$' \
        | sed '/^$/d' || true)
    [ -z "$risky" ] || die "code changed since $rc — rc and test again. Files: $(echo $risky)"

    dispatch "$base" false true
    check_release "$base"
    say "latest is now $(gh api "repos/$REPO/releases/latest" -q .tag_name)"
    say "next: bash scripts/release.sh cleanup $base   (dry run first)"
}

cmd_cleanup() {  # base, [--yes]
    local base=$1 apply=${2:-} start rels ids t id
    [ "$(gh api "repos/$REPO/releases/latest" -q .tag_name)" = "v$base" ] || die "v$base is not the latest release"
    start=$(cat "$STATE/$base.start" 2>/dev/null || true)
    [ -n "$start" ] || die "no build start time for $base on this machine — cleanup needs it"
    rels=$(gh release list --repo "$REPO" --limit 100 --json tagName -q '.[].tagName' | grep -v -x "v$base" || true)
    # Image versions pushed before the final build started. The final image
    # itself is never in this list: it was pushed after the start time.
    ids=$(gh api --paginate "/users/$OWNER/packages/container/aivinnet/versions" \
        -q ".[] | select(.created_at < \"$start\" and ((.metadata.container.tags // []) | index(\"v$base\") | not)) | .id")
    echo "releases to remove: ${rels:-none}"
    echo "image versions to remove: $(printf '%s\n' "$ids" | sed '/^$/d' | wc -l)"
    if [ "$apply" != "--yes" ]; then say "dry run — add --yes to remove"; return 0; fi

    for t in $rels; do
        if [[ $t == *-rc* ]]; then
            gh release delete "$t" --repo "$REPO" --yes --cleanup-tag
        else
            gh release delete "$t" --repo "$REPO" --yes   # finals keep their tag
        fi
    done
    for id in $ids; do
        gh api -X DELETE "/users/$OWNER/packages/container/aivinnet/versions/$id" >/dev/null
    done
    say "cleanup done"
}

cmd_status() {
    gh run list --repo "$REPO" --workflow build.yml --limit 3 \
        --json databaseId,status,conclusion,displayTitle \
        -q '.[] | "\(.databaseId)  \(if .conclusion == "" then .status else .conclusion end)  \(.displayTitle)"'
    gh release list --repo "$REPO" --limit 4
}

case ${1:-} in
    rc)      cmd_rc "${2:?usage: rc <base, e.g. 2026.10.4>}" ;;
    test)    cmd_test "${2:?usage: test <old, e.g. 2026.10.3>}" "${3:?usage: test <old> <new rc, e.g. 2026.10.4-rc1>}" ;;
    final)   cmd_final "${2:?usage: final <base, e.g. 2026.10.4>}" ;;
    cleanup) cmd_cleanup "${2:?usage: cleanup <base> [--yes]}" "${3:-}" ;;
    status)  cmd_status ;;
    *)       sed -n '2,16p' "$0" ;;
esac
