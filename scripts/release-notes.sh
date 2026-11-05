#!/usr/bin/env bash
#
# Prints the release notes of one version, from the store changelogs.
#
# Usage: scripts/release-notes.sh [version]     # default: package.json's
#
# The changelog of a store release is written once, in
# fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt. Google Play
# shows it (native.yml, the Google Play job), F-Droid reads it,
# and the GitHub release starts with it: native.yml passes this output to
# `gh release create --notes-file`, which puts it above the list of changes
# GitHub generates. One line of a changelog is one item here.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-$(node -p "require('$root/package.json').version")}"
IFS=. read -r major minor patch <<< "$version"
code=$(( major * 1000000 + minor * 1000 + patch ))

section() {
  local title="$1" file="$root/fastlane/metadata/android/$2/changelogs/${code}.txt"
  [ -f "$file" ] || return 0
  printf '## %s\n\n' "$title"
  sed -e '/^[[:space:]]*$/d' -e 's/^/- /' "$file"
  printf '\n'
}

section "What's new" en-US
section 'Nouveautés' fr-FR
