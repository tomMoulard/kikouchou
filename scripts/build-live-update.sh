#!/usr/bin/env bash
#
# Builds the store apps' live update into <dist>/live/: the web build the apps
# load, zipped and signed, under the fingerprint of the native layer it was
# built against (scripts/native-fingerprint.js).
#
# Usage: scripts/build-live-update.sh dist
#
# Writes:
#   <dist>/live/<fingerprint>.json        { bundleId, url, signature }
#   <dist>/live/<fingerprint>/<sha>.zip   the bundle
#
# src/lib/native/live-update.ts reads the manifest of its own fingerprint once
# per launch and stages the bundle for the next one. The plugin checks the
# signature against the public key in capacitor.config.ts, so the private key
# in LIVE_UPDATE_PRIVATE_KEY is what decides which code runs in every
# installed app. Keep it in the repository secrets and nowhere else.
#
# Needs LIVE_UPDATE_PRIVATE_KEY (PEM, RSA 2048), DEPLOY_SHA and the VITE_*
# values of the website build. Never fails the deploy: a missing key or a
# failed step is a warning, and the website ships without a live update.

set -euo pipefail

dist="${1:?usage: build-live-update.sh <dist>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

warn() {
  echo "::warning title=No live update::$1"
  exit 0
}

[ -n "${LIVE_UPDATE_PRIVATE_KEY:-}" ] || warn "LIVE_UPDATE_PRIVATE_KEY is unset."
sha="${DEPLOY_SHA:-$(git -C "$root" rev-parse HEAD)}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || warn "DEPLOY_SHA is not a commit sha: $sha"
fingerprint="$(node "$root/scripts/native-fingerprint.js")" || warn "no native fingerprint."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077
printf '%s\n' "$LIVE_UPDATE_PRIVATE_KEY" > "$work/key.pem"

# The apps hold the public key in capacitor.config.ts. A secret that does not
# match it would publish bundles every app refuses, so check before building.
openssl pkey -in "$work/key.pem" -pubout -out "$work/derived.pem" 2>/dev/null \
  || warn "LIVE_UPDATE_PRIVATE_KEY is not a readable private key."
expected="$(node -e '
  const text = require("fs").readFileSync(process.argv[1], "utf8");
  const block = text.match(/LIVE_UPDATE_PUBLIC_KEY =([\s\S]*?);/);
  if (!block) process.exit(1);
  const pem = [...block[1].matchAll(/'"'"'([^'"'"']*)'"'"'/g)].map((m) => m[1]).join("");
  process.stdout.write(pem.replace(/\\n/g, "").replace(/-----[A-Z ]+-----/g, ""));
' "$root/capacitor.config.ts")" || warn "no LIVE_UPDATE_PUBLIC_KEY in capacitor.config.ts."
derived="$(grep -v -- '-----' "$work/derived.pem" | tr -d '\n')"
[ "$expected" = "$derived" ] \
  || warn "LIVE_UPDATE_PRIVATE_KEY does not match the public key in capacitor.config.ts."

# The build the store apps ship (native.yml): the website's values minus the
# ad trackers, which an app never loads, and without source maps.
(
  cd "$root"
  VITE_META_PIXEL_ID='' VITE_GTM_CONTAINER_ID='' VITE_GOOGLE_ADS_ID='' \
    VITE_GOOGLE_ADS_INSTALL_CONVERSION='' VITE_NATIVE_FINGERPRINT="$fingerprint" \
    VITE_APP_VERSION="live@${sha}" \
    bunx vite build --outDir "$work/web" --emptyOutDir --logLevel warn
) || warn "the web build for the apps failed."
find "$work/web" -name '*.map' -type f -delete

(cd "$work/web" && zip -q -r -X "$work/bundle.zip" .) || warn "zip failed."
signature="$(openssl dgst -sha256 -sign "$work/key.pem" "$work/bundle.zip" | base64 | tr -d '\n')" \
  || warn "signing failed."
echo "$signature" | base64 --decode > "$work/bundle.sig"
openssl dgst -sha256 -verify "$work/derived.pem" -signature "$work/bundle.sig" "$work/bundle.zip" >/dev/null \
  || warn "the signature does not verify."

origin="${VITE_PUBLIC_APP_ORIGIN:-https://app.kikouchou.app}"
mkdir -p "$dist/live/$fingerprint"
cp "$work/bundle.zip" "$dist/live/$fingerprint/$sha.zip"
node -e '
  const [file, bundleId, url, signature] = process.argv.slice(1);
  require("fs").writeFileSync(file, JSON.stringify({ bundleId, url, signature }) + "\n");
' "$dist/live/$fingerprint.json" "$sha" "$origin/live/$fingerprint/$sha.zip" "$signature"
echo "Live update $sha written to $dist/live/$fingerprint ($(du -h "$work/bundle.zip" | cut -f1))"
