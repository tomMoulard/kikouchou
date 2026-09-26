#!/usr/bin/env bash
#
# Builds a self-hosted F-Droid repository into <dist>/fdroid/repo, from the
# latest GitHub release's F-Droid APK.
#
# Usage: scripts/build-fdroid-repo.sh dist
#
# An F-Droid client adds https://app.kikouchou.app/fdroid/repo and gets every
# release the day it is tagged, signed with this project's key. The official
# f-droid.org catalogue builds from source instead, from
# metadata/app.kikouchou.yml, and reaches people a few days later.
#
# Needs FDROID_KEYSTORE_BASE64 (a PKCS12 keystore holding the repository's
# index key, alias `kikouchou`) and FDROID_KEYSTORE_PASSWORD. The index key
# signs the repository's index; it is not the key the APK is signed with, and
# losing it means every client has to add the repository again.
#
# Never fails the deploy: a missing key, a missing release or a missing tool is
# a warning, and the website ships without the repository.

set -euo pipefail

dist="${1:?usage: build-fdroid-repo.sh <dist>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

warn() {
  echo "::warning title=No F-Droid repository::$1"
  exit 0
}

[ -n "${FDROID_KEYSTORE_BASE64:-}" ] || warn "FDROID_KEYSTORE_BASE64 is unset."
[ -n "${FDROID_KEYSTORE_PASSWORD:-}" ] || warn "FDROID_KEYSTORE_PASSWORD is unset."
command -v fdroid >/dev/null 2>&1 || warn "fdroidserver is not installed."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/repo" "$work/metadata"

gh release download --repo "${GITHUB_REPOSITORY:?}" --pattern '*-fdroid.apk' --dir "$work/repo" \
  || warn "the latest release carries no F-Droid APK yet."

cp "$root/metadata/app.kikouchou.yml" "$work/metadata/"
# The store listing, in the layout fdroidserver reads next to the metadata file.
if [ -d "$root/fastlane/metadata/android" ]; then
  mkdir -p "$work/metadata/app.kikouchou"
  cp -R "$root/fastlane/metadata/android/." "$work/metadata/app.kikouchou/"
fi

echo "$FDROID_KEYSTORE_BASE64" | base64 --decode > "$work/keystore.p12"
cat > "$work/config.yml" <<CONFIG
repo_url: https://app.kikouchou.app/fdroid/repo
repo_name: Kikouchou
repo_description: >-
  The Kikouchou app, straight from its own releases. Kikouchou plans a house
  full of friends: who sleeps where, and who picks up whom.
repo_icon: icon.png
repo_keyalias: kikouchou
keystore: keystore.p12
keystorepass: ${FDROID_KEYSTORE_PASSWORD}
keypass: ${FDROID_KEYSTORE_PASSWORD}
keydname: CN=Kikouchou, O=Kikouchou
CONFIG
chmod 600 "$work/config.yml" "$work/keystore.p12"
mkdir -p "$work/repo/icons"
cp "$root/public/icons/icon-512.png" "$work/repo/icons/icon.png" 2>/dev/null || true

(cd "$work" && fdroid update --pretty)

mkdir -p "$dist/fdroid"
rm -rf "$dist/fdroid/repo"
cp -R "$work/repo" "$dist/fdroid/repo"
echo "F-Droid repository written to $dist/fdroid/repo"
