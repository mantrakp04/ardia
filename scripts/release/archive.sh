#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/archive.sh <dist> <framework> <derived data> <adhoc|xcode> [<build setting>…]"
dist="${1:?$usage}"
framework="${2:?$usage}"
build="${3:?$usage}"
signing="${4:?$usage}"
shift 4
. "$(dirname "$0")/lib.sh"
case "$signing" in
  adhoc) archive_signing=(-xcconfig macos/AdHoc.xcconfig) ;;
  xcode) archive_signing=(-allowProvisioningUpdates) ;;
  *) die "$usage" ;;
esac

echo "==> Content blocker"
"$ardiacore/scripts/ubo.sh"
[ -f "$ardiacore/vendor/ubo/ext/manifest.json" ] || die "uBlock Origin isn't installed ($ardiacore/scripts/ubo.sh)"

echo "==> Archive"
(cd "$root/apps/browser" && ARDIACORE_FRAMEWORK="$framework" "$root/scripts/agent/locked" pod --wait 1800 -- \
  "$root/scripts/agent/locked" xcodebuild --wait 1800 -- xcodebuild -workspace macos/Ardia.xcworkspace -scheme Ardia-macOS \
  -configuration Release -destination 'generic/platform=macOS' ARCHS=arm64 ARDIACORE_STAGE_DIR="$build/ArdiaCoreFramework" \
  "$@" -derivedDataPath "$build" -archivePath "$dist/Ardia.xcarchive" "${archive_signing[@]}" archive) \
  > "$dist/archive.log" 2>&1 || {
  grep -E "error:|build commands failed" -A2 "$dist/archive.log" | grep -v MACOSX_DEPLOYMENT_TARGET | tail -20 >&2
  die "archive failed ($dist/archive.log)"
}
