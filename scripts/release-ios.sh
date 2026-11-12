#!/usr/bin/env bash
# Build the iPhone app for App Store Connect and send it to TestFlight.
#
#   scripts/release-ios.sh <build number> [--no-upload] [--default-browser] [--out <dir>]
#   scripts/release-ios.sh -h | --help
#
# Archives the Ardia scheme in Release with <build number> as every target's build number, then exports
# it signed for App Store Connect and uploads it. --no-upload stops at the signed .ipa. The version is
# MARKETING_VERSION in apps/ios/project.yml. Output and logs go to dist/ios/<version>-<build>, or --out.
#
# Signing is automatic. With ASC_KEY (path to AuthKey_<id>.p8), ASC_KEY_ID and ASC_ISSUER set, xcodebuild
# signs and uploads with that App Store Connect API key; without them it uses the account Xcode is signed
# in to.
#
# --default-browser builds with ARDIA_DEFAULT_BROWSER=YES: the app signs with
# Config/Ardia-DefaultBrowser.entitlements, which carries com.apple.developer.web-browser, and offers
# its default browser steps in onboarding and Settings. Use it only once Apple has granted that
# entitlement to the App ID; until then signing fails with it. Without the flag the app signs with
# Config/Ardia.entitlements, iOS doesn't list it as a browser, and the app hides those steps.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ios="$root/apps/ios"

die() { echo "error: $*" >&2; exit 1; }

help() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}

build="" upload=1 default_browser=NO out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) help ;;
    --no-upload) upload=0; shift ;;
    --default-browser) default_browser=YES; shift ;;
    --out) [ $# -ge 2 ] || die "--out needs a directory"; out="$2"; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$build" ] || die "one build number, got $build and $1"; build="$1"; shift ;;
  esac
done
[[ "$build" =~ ^[1-9][0-9]*$ ]] || die "the build number must be a positive integer (scripts/release-ios.sh --help)"

version="$(sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$ios/project.yml" | head -1)"
[ -n "$version" ] || die "no MARKETING_VERSION in apps/ios/project.yml"

out="${out:-$root/dist/ios/$version-$build}"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
archive="$out/Ardia.xcarchive"

auth=()
if [ -n "${ASC_KEY:-}" ]; then
  [ -f "$ASC_KEY" ] || die "ASC_KEY is not a file: $ASC_KEY"
  [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER:-}" ] || die "ASC_KEY needs ASC_KEY_ID and ASC_ISSUER"
  key="$(cd "$(dirname "$ASC_KEY")" && pwd -P)/$(basename "$ASC_KEY")"
  auth=(-authenticationKeyPath "$key" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER")
fi

without_key_ids() {
  [ ${#auth[@]} -gt 0 ] || return 0
  ASC_KEY_ID="$ASC_KEY_ID" ASC_ISSUER="$ASC_ISSUER" perl -pi -e 's/\Q$ENV{ASC_KEY_ID}\E/<key id>/g; s/\Q$ENV{ASC_ISSUER}\E/<issuer>/g' "$1"
}

run_logged() {
  local name="$1" log="$out/$1.log" status=0
  shift
  echo "==> $name (log: $log)"
  "$@" >"$log" 2>&1 || status=$?
  without_key_ids "$log"
  if [ "$status" != 0 ]; then
    grep -E "error:|Error Domain|errors? occurred|\*\* .* FAILED \*\*" "$log" | sort -u | tail -40 >&2 || true
    tail -15 "$log" >&2
    die "$name failed"
  fi
}

echo "Ardia for iPhone $version ($build), default browser $default_browser"

rm -rf "$archive" "$out/export"
run_logged archive xcodebuild archive \
  -project "$ios/Ardia.xcodeproj" -scheme Ardia -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$archive" -derivedDataPath "$out/dd" \
  -allowProvisioningUpdates ${auth[@]+"${auth[@]}"} \
  CURRENT_PROJECT_VERSION="$build" \
  ARDIA_DEFAULT_BROWSER="$default_browser" \
  COMPILER_INDEX_STORE_ENABLE=NO

app="$archive/Products/Applications/Ardia.app"
[ -d "$app" ] || die "the archive has no Ardia.app"
plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Info.plist"; }
[ "$(plist_value "$app" CFBundleIdentifier)" = com.ardia.browser.ios ] || die "the archive is $(plist_value "$app" CFBundleIdentifier)"
for bundle in "$app" "$app"/PlugIns/*.appex; do
  [ "$(plist_value "$bundle" CFBundleVersion)" = "$build" ] || die "$(basename "$bundle") is build $(plist_value "$bundle" CFBundleVersion), not $build"
  [ "$(plist_value "$bundle" CFBundleShortVersionString)" = "$version" ] || die "$(basename "$bundle") is version $(plist_value "$bundle" CFBundleShortVersionString), not $version"
done
[ "$(find "$app/PlugIns" -maxdepth 1 -name '*.appex' | wc -l | tr -d ' ')" = 3 ] || die "the archive should hold three extensions"
[ "$(plist_value "$app" ArdiaDefaultBrowser)" = "$default_browser" ] || die "the app offers the default browser steps: $(plist_value "$app" ArdiaDefaultBrowser), expected $default_browser"
signed=NO
if codesign -d --entitlements - --xml "$app" 2>/dev/null | plutil -extract 'com\.apple\.developer\.web-browser' raw -o - - 2>/dev/null | grep -qx true; then signed=YES; fi
[ "$signed" = "$default_browser" ] || die "the app's signature carries the default browser entitlement: $signed, expected $default_browser"

options="$out/ExportOptions.plist"
cp "$ios/Config/ExportOptions-TestFlight.plist" "$options"
if [ "$upload" = 1 ]; then step=upload; else
  step=export
  /usr/libexec/PlistBuddy -c "Set :destination export" "$options"
fi
run_logged "$step" xcodebuild -exportArchive \
  -archivePath "$archive" -exportOptionsPlist "$options" -exportPath "$out/export" \
  -allowProvisioningUpdates ${auth[@]+"${auth[@]}"}

if [ "$upload" = 1 ]; then
  echo "Uploaded Ardia for iPhone $version ($build) to App Store Connect."
else
  ipa="$(find "$out/export" -maxdepth 1 -name '*.ipa' | head -1)"
  [ -n "$ipa" ] || die "the export wrote no .ipa"
  echo "Signed, not uploaded: $ipa"
fi
