#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/engine-source.sh <version> <out.tar.xz>"
version="${1:?$usage}"
out="${2:?$usage}"
root="$(cd "$(dirname "$0")/.." && pwd -P)"
die() { echo "error: $*" >&2; exit 1; }
. "$root/scripts/identity.sh"
repo="$(ac_identity AC_RELEASE_REPO)"
[ -n "$repo" ] || die "the app's identity has no AC_RELEASE_REPO"
pinned() { [ -n "${!1:-}" ] && echo "${!1}" || sed -n "s/^export $1=//p" "$root/engine/patches/build/env.sh"; }
chromium="$(pinned CHROMIUM_VERSION)"
helium="$(pinned HELIUM_TAG)"
helium_macos="$(pinned HELIUM_MACOS_TAG)"
[ -n "$chromium" ] && [ -n "$helium" ] && [ -n "$helium_macos" ] \
  || die "engine/patches/build/env.sh pins no CHROMIUM_VERSION, HELIUM_TAG and HELIUM_MACOS_TAG"

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-engine-source.XXXXXX")"
trap 'rm -rf "$work"' EXIT
name="ardia-engine-source-$version"
src="$work/$name"
mkdir -p "$src"
fetch() {
  curl -fsSL --retry 3 --max-time 600 "https://codeload.github.com/imputnet/$1/tar.gz/refs/tags/$2" -o "$src/$1-$2.tar.gz" \
    || die "couldn't download imputnet/$1 at $2"
}
fetch helium-chromium "$helium"
fetch helium-macos "$helium_macos"
helium_top="$(tar -tzf "$src/helium-chromium-$helium.tar.gz" | awk 'NR == 1')"
deps="$(tar -xzOf "$src/helium-chromium-$helium.tar.gz" "${helium_top%%/*}/deps.ini")" \
  || die "helium-chromium $helium has no deps.ini"
dep_version() { awk -v s="[$1]" '$0 == s { on = 1; next } /^\[/ { on = 0 } on && $1 == "version" { print $3; exit }' <<<"$deps"; }
onboarding="$(dep_version onboarding)"
ublock="$(dep_version ublock_origin)"
[ -n "$onboarding" ] && [ -n "$ublock" ] || die "helium-chromium $helium's deps.ini pins no onboarding or ublock_origin version"
fetch helium-onboarding "$onboarding"
fetch uBlock "$ublock"

cat >"$src/README.txt" <<EOF
The source of the engine in Ardia $version, besides Ardia's own repository.

Ardia, with the engine's patches and build scripts:
  https://github.com/$repo/tree/v$version
  How to build it: docs/engine-build.md there.

Chromium $chromium (BSD-3-Clause and others):
  https://chromium.googlesource.com/chromium/src/+/refs/tags/$chromium
  https://commondatastorage.googleapis.com/chromium-browser-official/chromium-$chromium.tar.xz

Helium (GPL-3.0), copies of github.com/imputnet's tags:
  helium-chromium-$helium.tar.gz   its patches, domain substitution and build utilities
  helium-macos-$helium_macos.tar.gz   its macOS patches
  helium-onboarding-$onboarding.tar.gz   pinned in its deps.ini
  uBlock-$ublock.tar.gz   Helium's uBlock Origin, pinned in its deps.ini
EOF

tar --no-mac-metadata -cJf "$out" -C "$work" "$name"
echo "$out"
