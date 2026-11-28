#!/usr/bin/env bash
# Release helper: one command per step, short output. The long logs stay on
# the test host.
#
#   bash scripts/release.sh rc      2026.10.4                 build 2026.10.4-rc1 (prerelease + Docker)
#   bash scripts/release.sh test    2026.10.3 2026.10.4-rc1   update tests on the test host
#   bash scripts/release.sh final   2026.10.4                 build the final release (latest)
#   bash scripts/release.sh cleanup 2026.10.4 [--yes]         old release, rc tags, old images (dry run without --yes)
#   bash scripts/release.sh status                            latest builds and releases
#   bash scripts/release.sh verify  2026.11.11                checks a published release (curl only, no gh)
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
    ids=$(gh api --paginate "users/$OWNER/packages/container/aivinnet/versions" \
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
        gh api -X DELETE "users/$OWNER/packages/container/aivinnet/versions/$id" >/dev/null
    done
    say "cleanup done"
}

cmd_status() {
    gh run list --repo "$REPO" --workflow build.yml --limit 3 \
        --json databaseId,status,conclusion,displayTitle \
        -q '.[] | "\(.databaseId)  \(if .conclusion == "" then .status else .conclusion end)  \(.displayTitle)"'
    gh release list --repo "$REPO" --limit 4
}

# Checks a published release without gh (curl, python3, sha256sum only).
# Exit 0: all OK. Exit 2: only the macOS binary is missing. Exit 1: anything else.
V_OK=0 V_FAIL=0 V_WAIT=0 V_MAC=0 VFY_WORK="" VFY_PID="" VFY_PORT=""
v_ok()   { echo "OK    $1"; V_OK=$((V_OK + 1)); }
v_fail() { echo "FEHLT $1: $2"; V_FAIL=$((V_FAIL + 1)); }
v_wait() { echo "WARTET $1: $2"; V_WAIT=$((V_WAIT + 1)); }
jget()   { python3 -I -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

verify_cleanup() {
    if [ -n "$VFY_PID" ]; then kill "$VFY_PID" 2>/dev/null || true; fi
    if [ -n "$VFY_PORT" ]; then pkill -f "[a]ivinnet_linux_x86_64 --host 127.0.0.1 --port $VFY_PORT" 2>/dev/null || true; fi
    if [ -n "$VFY_WORK" ]; then rm -rf "$VFY_WORK"; fi
    return 0
}

# Starts the Linux binary on a free port and checks what a user sees first.
verify_smoke() {  # tag, download base
    local tag=$1 dl=$2 bin cfg log pw base i code lcode hdr h missing expected found seen ver sum_out up
    bin="$VFY_WORK/aivinnet_linux_x86_64"; cfg="$VFY_WORK/cfg"; log="$VFY_WORK/log"
    if ! curl -fsSL -o "$bin" "$dl/aivinnet_linux_x86_64" 2>/dev/null; then
        v_fail "Binary-Download" "aivinnet_linux_x86_64 nicht ladbar"; return 0
    fi
    sum_out=$(cd "$VFY_WORK" && sha256sum -c SHA256SUMS --ignore-missing 2>&1) || true
    case $sum_out in
        *"aivinnet_linux_x86_64: OK"*) v_ok "Binary-Hash stimmt mit SHA256SUMS" ;;
        *) v_fail "Binary-Hash" "${sum_out:-keine Ausgabe}" ;;
    esac
    chmod +x "$bin"
    ver=$("$bin" --version 2>&1) || ver=""
    case $ver in
        *"v$tag"*) v_ok "Binary --version: $ver" ;;
        *) v_fail "Binary --version" "erwartet v$tag, ausgegeben: ${ver:-nichts}" ;;
    esac

    expected=$(curl -fsS "https://raw.githubusercontent.com/$REPO/v$tag/client/package.json" 2>/dev/null | jget 'd["version"]') || expected=""
    mkdir -p "$VFY_WORK/zip" "$VFY_WORK/clientzip"
    if ! curl -fsSL -o "$VFY_WORK/zip/client.zip" "$dl/client.zip" 2>/dev/null \
        || ! python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' \
            "$VFY_WORK/zip/client.zip" "$VFY_WORK/clientzip" 2>/dev/null; then
        v_fail "Client-Paket" "client.zip von v$tag nicht ladbar oder kaputt"
    fi

    VFY_PORT=$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
    pw=$(python3 -I -c 'import secrets; print(secrets.token_urlsafe(16))')
    base="http://127.0.0.1:$VFY_PORT"
    AIVINNET_ADMIN_PASSWORD="$pw" "$bin" --host 127.0.0.1 --port "$VFY_PORT" --config "$cfg" >"$log" 2>&1 &
    VFY_PID=$!

    up=0
    for i in $(seq 1 60); do
        if curl -s -o /dev/null "$base/"; then up=1; break; fi
        sleep 1
    done
    if [ "$up" != 1 ]; then
        v_fail "Server-Start" "keine Antwort nach 60 s, Log unten"
        echo "--- Log (Ende) ---"; tail -20 "$log" 2>/dev/null || true
        return 0
    fi
    v_ok "Server antwortet auf Port $VFY_PORT"

    code=$(curl -s -o /dev/null -w '%{http_code}' "$base/") || code=""
    if [ "$code" = 200 ]; then v_ok "GET / -> 200"; else v_fail "GET /" "HTTP ${code:-keine Antwort}"; fi

    code=$(curl -s -o /dev/null -w '%{http_code}' "$base/auth/user") || code=""
    if [ "$code" = 401 ]; then v_ok "GET /auth/user ohne Login -> 401"; else v_fail "GET /auth/user ohne Login" "HTTP ${code:-keine Antwort}, erwartet 401"; fi

    lcode=$(curl -s -o /dev/null -c "$VFY_WORK/jar" -w '%{http_code}' -H 'Content-Type: application/json' \
        -d "{\"username\":\"admin\",\"password\":\"$pw\"}" "$base/auth/login") || lcode=""
    code=$(curl -s -o /dev/null -w '%{http_code}' -b "$VFY_WORK/jar" "$base/auth/user") || code=""
    if [ "$code" = 200 ]; then v_ok "Login (HTTP $lcode) und GET /auth/user -> 200"; else v_fail "Login" "Login HTTP ${lcode:-?}, /auth/user HTTP ${code:-keine Antwort}"; fi

    hdr=$(curl -s -D - -o /dev/null "$base/") || hdr=""
    missing=""
    for h in X-Frame-Options Content-Security-Policy X-Content-Type-Options Referrer-Policy; do
        grep -qi "^$h:" <<< "$hdr" || missing="$missing $h"
    done
    if [ -z "$missing" ]; then v_ok "Sicherheits-Header auf /"; else v_fail "Sicherheits-Header" "fehlen:$missing"; fi

    if [ -z "$expected" ]; then
        v_fail "Client-Version" "client/package.json von v$tag nicht lesbar"
    else
        # The version sits in a lazily loaded chunk, so grep the whole release client.
        found=$(grep -rlF --include='*.js' "name:\`aivinnet-client\`,version:\`$expected\`" "$VFY_WORK/clientzip" 2>/dev/null) || found=""
        if [ -n "$found" ]; then
            v_ok "Client-Version $expected im client.zip"
        else
            seen=$(grep -rhoE --include='*.js' 'name:`aivinnet-client`,version:`[^`]*`' "$VFY_WORK/clientzip" 2>/dev/null | sort -u | tr '\n' ' ') || seen=""
            v_fail "Client-Version" "erwartet $expected, im client.zip gefunden: ${seen:-nichts}"
        fi
    fi
    if curl -s "$base/" | cmp -s - "$VFY_WORK/clientzip/client/index.html"; then
        v_ok "Server liefert die index.html aus client.zip"
    else
        v_fail "Server-Client" "index.html des Servers weicht von client.zip ab"
    fi

    kill "$VFY_PID" 2>/dev/null || true
    pkill -f "[a]ivinnet_linux_x86_64 --host 127.0.0.1 --port $VFY_PORT" 2>/dev/null || true
    VFY_PID=""
}

cmd_verify() {  # tag, e.g. 2026.11.11
    local tag=$1 api dl want a names rel latest flags extra x sums missing tok digest_v digest_l t d
    [[ $tag =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "verify: '$tag' is no tag like 2026.11.11"
    api=https://api.github.com/repos/$REPO
    dl=https://github.com/$REPO/releases/download/v$tag
    V_OK=0 V_FAIL=0 V_WAIT=0 V_MAC=0
    VFY_WORK=$(mktemp -d)
    trap verify_cleanup EXIT

    # 1. Release exists and is published
    rel=$(curl -fsS "$api/releases/tags/v$tag" 2>/dev/null) || rel=""
    if [ -z "$rel" ]; then
        v_fail "Release v$tag" "nicht gefunden ($api/releases/tags/v$tag)"
    else
        flags=$(printf '%s' "$rel" | jget 'd["draft"], d["prerelease"]') || flags=""
        case $flags in
            "False False") v_ok "Release v$tag ist veröffentlicht" ;;
            "True "*) v_fail "Release v$tag" "ist noch ein Entwurf" ;;
            *"True") v_fail "Release v$tag" "ist eine Vorabversion" ;;
            *) v_fail "Release v$tag" "Antwort unlesbar: ${flags:-leer}" ;;
        esac
    fi

    # 2. It is the latest release
    latest=$(curl -fsS "$api/releases/latest" 2>/dev/null | jget 'd["tag_name"]') || latest=""
    if [ "$latest" = "v$tag" ]; then v_ok "latest ist v$tag"; else v_fail "latest" "ist '${latest:-unbekannt}', erwartet v$tag"; fi

    # 3. Assets
    want="aivinnet-$tag-py3-none-any.whl aivinnet-v$tag-aarch64.AppImage aivinnet-v$tag-x86_64.AppImage aivinnet_darwin_arm64 aivinnet_linux_aarch64 aivinnet_linux_x86_64 aivinnet_windows_amd64.exe aivinnet_windows_arm64.exe client.zip SHA256SUMS"
    names=""
    if [ -n "$rel" ]; then
        names=$(printf '%s' "$rel" | jget '"\n".join(a["name"] for a in d["assets"])') || names=""
    fi
    if [ -z "$names" ]; then
        v_fail "Assets" "keine Asset-Liste (Release fehlt?)"
    else
        for a in $want; do
            if grep -qxF "$a" <<< "$names"; then
                v_ok "Asset $a"
            elif [ "$a" = aivinnet_darwin_arm64 ]; then
                v_wait "Asset $a" "fehlt (GitHub hat oft keinen macOS-Runner)"
                V_MAC=1
            else
                v_fail "Asset $a" "fehlt"
            fi
        done
        extra=""
        while IFS= read -r x; do
            [ -z "$x" ] && continue
            case " $want " in *" $x "*) ;; *) extra="$extra $x" ;; esac
        done <<< "$names"
        echo "INFO  weitere Assets:${extra:- keine}"
    fi

    # 4. SHA256SUMS lists every present asset
    sums="$VFY_WORK/SHA256SUMS"
    if ! curl -fsSL -o "$sums" "$dl/SHA256SUMS" 2>/dev/null; then
        v_fail "SHA256SUMS" "Download von $dl/SHA256SUMS fehlgeschlagen"
    else
        missing=""
        while IFS= read -r x; do
            [ -z "$x" ] && continue
            [ "$x" = SHA256SUMS ] && continue
            awk -v n="$x" '{ f=$2; sub(/^\*/, "", f); if (f == n) hit = 1 } END { exit !hit }' "$sums" || missing="$missing $x"
        done <<< "$names"
        if [ -z "$missing" ]; then
            v_ok "SHA256SUMS listet alle Assets"
        else
            v_fail "SHA256SUMS" "listet nicht:$missing"
        fi
    fi

    # 5. Docker image: v<tag> and latest must be the same image
    tok=$(curl -fsS "https://ghcr.io/token?scope=repository:${REPO,,}:pull" 2>/dev/null | jget 'd["token"]') || tok=""
    if [ -z "$tok" ]; then
        v_fail "Docker" "kein Pull-Token von ghcr.io"
    else
        for t in "v$tag" latest; do
            d=$(curl -fsSI -H "Authorization: Bearer $tok" \
                -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
                "https://ghcr.io/v2/${REPO,,}/manifests/$t" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" { print $2 }') || d=""
            if [ "$t" = "v$tag" ]; then digest_v=$d; else digest_l=$d; fi
        done
        if [ -z "$digest_v" ]; then
            v_fail "Docker v$tag" "Manifest fehlt"
        elif [ -z "$digest_l" ]; then
            v_fail "Docker latest" "Manifest fehlt"
        elif [ "$digest_v" = "$digest_l" ]; then
            v_ok "Docker v$tag = latest (${digest_v:0:19})"
        else
            v_fail "Docker latest" "${digest_l:0:19} statt v$tag ${digest_v:0:19}"
        fi
    fi

    # 6. Smoke test of the Linux binary
    if [ "$(uname -m)" != x86_64 ]; then
        v_wait "Binary-Rauchtest" "nur auf x86_64"
    else
        verify_smoke "$tag" "$dl"
    fi

    echo "---"
    echo "Ergebnis v$tag: $V_OK OK, $V_FAIL FEHLT, $V_WAIT WARTET"
    if [ "$V_FAIL" -gt 0 ]; then exit 1; fi
    if [ "$V_MAC" = 1 ]; then
        echo "macOS fehlt: Lauf mit rerun_failed_jobs neu starten, nachts klappt es meist"
        exit 2
    fi
    exit 0
}

case ${1:-} in
    rc)      cmd_rc "${2:?usage: rc <base, e.g. 2026.10.4>}" ;;
    test)    cmd_test "${2:?usage: test <old, e.g. 2026.10.3>}" "${3:?usage: test <old> <new rc, e.g. 2026.10.4-rc1>}" ;;
    final)   cmd_final "${2:?usage: final <base, e.g. 2026.10.4>}" ;;
    cleanup) cmd_cleanup "${2:?usage: cleanup <base> [--yes]}" "${3:-}" ;;
    status)  cmd_status ;;
    verify)  cmd_verify "${2:?usage: verify <tag, e.g. 2026.11.11>}" ;;
    *)       sed -n '2,17p' "$0" ;;
esac
