#!/usr/bin/env bash
# Creates the fixed signing key for the Android app and hands it to GitHub, in one go.
#
#   bash scripts/android-signing-key.sh
#
# Run it once, on your own machine (Linux, WSL or macOS), never in CI or a shared session:
# the key must exist only with you and in the repository secrets. What it does:
#   1. installs keytool if it is missing (Debian/Ubuntu, asks first),
#   2. creates ~/aivinnet-release.jks with a random password, saved next to it
#      (~/aivinnet-release.password, readable only by you),
#   3. with the GitHub CLI (gh, signed in): sets the four ANDROID_* secrets and starts the
#      Android workflow on master, which builds the signed APK (artifact aivinnet-auto-apk);
#      without gh: prints what to enter under Settings → Secrets and variables → Actions.
#
# Keep both files (password manager, backup). Without them no update installs over the app
# anymore. Refuses to touch an existing key: a second key would be exactly that problem.
set -euo pipefail

REPO="${AIVINNET_REPO:-vwellenberg/AivinNet}"
ALIAS="aivinnet"
KEYSTORE="${AIVINNET_KEYSTORE:-$HOME/aivinnet-release.jks}"
PASSFILE="${KEYSTORE%.jks}.password"

say() { printf '\n==> %s\n' "$*"; }

if [ -e "$KEYSTORE" ]; then
    echo "There already is a key at $KEYSTORE. Not overwriting it." >&2
    echo "If its secrets are missing on GitHub, set them from that file (see android/README.md)." >&2
    exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        read -r -p "keytool is missing. Install openjdk-21-jdk-headless with sudo apt-get? [y/N] " answer
        [ "${answer,,}" = "y" ] || { echo "Aborted." >&2; exit 1; }
        sudo apt-get update -q
        sudo apt-get install -y -q openjdk-21-jdk-headless
    else
        echo "keytool is missing: install a JDK (e.g. Temurin 21) and run this again." >&2
        exit 1
    fi
fi

say "Creating the key at $KEYSTORE"
umask 077
# A random password: nothing to type, nothing to mistype. 32 characters, no symbols a shell
# or the GitHub form could mangle.
PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
printf '%s\n' "$PASSWORD" > "$PASSFILE"
# The password goes in through the environment (:env), not the command line, which every
# process on the machine can read.
export AIVINNET_KEY_PW="$PASSWORD"
keytool -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" -keyalg RSA -keysize 4096 \
    -validity 10000 -dname "CN=AivinNet" \
    -storepass:env AIVINNET_KEY_PW -keypass:env AIVINNET_KEY_PW -noprompt >/dev/null
unset AIVINNET_KEY_PW
echo "Key:      $KEYSTORE"
echo "Password: $PASSFILE"

KEYSTORE_B64="$(base64 -w0 "$KEYSTORE" 2>/dev/null || base64 < "$KEYSTORE" | tr -d '\n')"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    say "Setting the secrets on $REPO"
    # Values through stdin, not as arguments.
    printf '%s' "$KEYSTORE_B64" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
    printf '%s' "$PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
    printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
    printf '%s' "$PASSWORD" | gh secret set ANDROID_KEY_PASSWORD --repo "$REPO"

    say "Starting the Android workflow on master"
    gh workflow run android.yml --repo "$REPO" --ref master
    echo "In a few minutes: Actions → Android → the newest run → artifact aivinnet-auto-apk."
else
    say "No signed-in GitHub CLI (gh): enter the secrets by hand"
    echo "On GitHub: $REPO → Settings → Secrets and variables → Actions → New repository secret"
    echo
    echo "  ANDROID_KEY_ALIAS          $ALIAS"
    echo "  ANDROID_KEYSTORE_PASSWORD  the line in $PASSFILE"
    echo "  ANDROID_KEY_PASSWORD       the same line"
    echo "  ANDROID_KEYSTORE_BASE64    the long text (see below)"
    if command -v clip.exe >/dev/null 2>&1; then
        printf '%s' "$KEYSTORE_B64" | clip.exe
        echo
        echo "ANDROID_KEYSTORE_BASE64 is in the Windows clipboard now: paste it as the value."
    else
        echo
        echo "ANDROID_KEYSTORE_BASE64: the output of  base64 -w0 \"$KEYSTORE\""
    fi
    echo
    echo "Then: Actions → Android → Run workflow (branch master)."
fi

say "Done. Put $KEYSTORE and $PASSFILE into your password manager or a backup."
