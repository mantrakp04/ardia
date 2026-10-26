#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/lib/export-developer-id.sh <archived Ardia.app> <exported Ardia.app> <provisioning profile> <entitlements> <identity> <bundle id>"
source_app="${1:?$usage}"
app="${2:?$usage}"
profile="${3:?$usage}"
entitlements_template="${4:?$usage}"
identity="${5:?$usage}"
bundle_id="${6:?$usage}"
die() { echo "error: $*" >&2; exit 1; }

[ -d "$source_app" ] || die "no $source_app"
[ -f "$profile" ] || die "no provisioning profile at $profile"
work="$(mktemp -d "${TMPDIR:-/tmp}/ac-export.XXXXXX")"
trap 'rm -rf "$work"' EXIT
security cms -D -i "$profile" > "$work/profile.plist" 2>/dev/null || die "$profile isn't a signed provisioning profile"
profile_value() { plutil -extract "$1" raw "$work/profile.plist" 2>/dev/null; }
team="$(profile_value TeamIdentifier.0)"
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || die "$profile has no team identifier"
[[ "$bundle_id" =~ ^[A-Za-z0-9.-]+$ ]] || die "the bundle id must be letters, digits, dots and hyphens"
[ "$(plutil -extract CFBundleIdentifier raw "$source_app/Contents/Info.plist" 2>/dev/null)" = "$bundle_id" ] \
  || die "the archived app's CFBundleIdentifier isn't $bundle_id"
app_id="$(profile_value 'Entitlements.com\.apple\.application-identifier')"
[ -n "$team" ] && [ "$app_id" = "$team.$bundle_id" ] || die "$profile is for ${app_id:-no app id}, not $team.$bundle_id"
[ "$(profile_value ProvisionsAllDevices)" = true ] || die "$profile isn't a Developer ID profile"
expires="$(profile_value ExpirationDate)"
[ "$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$expires" +%s)" -gt "$(date -u +%s)" ] || die "$profile expired on $expires"

sed -e "s/\$(AppIdentifierPrefix)/$team./g" -e "s/\$(PRODUCT_BUNDLE_IDENTIFIER)/$bundle_id/g" \
  "$entitlements_template" > "$work/app.entitlements"
! grep -q '\$(' "$work/app.entitlements" || die "$entitlements_template uses a build setting this export doesn't expand"
plutil -insert 'com\.apple\.application-identifier' -string "$app_id" "$work/app.entitlements"
plutil -insert 'com\.apple\.developer\.team-identifier' -string "$team" "$work/app.entitlements"
plutil -lint -s "$work/app.entitlements" || die "the expanded entitlements aren't a valid plist"

sign() {
  local attempt
  for attempt in 1 2 3 4 5; do
    codesign --force --timestamp --sign "$identity" "$@" && return 0
    echo "    signing failed (attempt $attempt), likely no timestamp from Apple; retrying" >&2
    sleep 5
  done
  die "couldn't sign ${*: -1}"
}

requirement() {
  printf 'designated => anchor apple generic and identifier "%s" and (certificate leaf[field.1.2.840.113635.100.6.1.9] or certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = %s)' "$1" "$team"
}
identifier() {
  local id
  id="$(codesign -dv "$1" 2>&1 | sed -n 's/^Identifier=//p')"
  [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || die "$1 has an unexpected code signing identifier"
  printf '%s' "$id"
}

rm -rf "$app"
mkdir -p "$(dirname "$app")"
ditto "$source_app" "$app"
cp "$profile" "$app/Contents/embedded.provisionprofile"
while IFS= read -r -d '' code; do
  id="$(identifier "$code")"
  [ -n "$id" ] || die "$code isn't signed"
  sign --preserve-metadata=identifier,entitlements,flags,runtime -r="$(requirement "$id")" "$code"
done < <(find "$app/Contents" -depth -not -path "*/Chromium Framework.framework/*" -not -name "Chromium Framework.framework" \
  \( -type d \( -name "*.xpc" -o -name "*.app" -o -name "*.appex" -o -name "*.framework" -o -name "*.plugin" \) \
  -o -type f \( -name "*.dylib" -o -path "*.framework/Versions/*/Autoupdate" \) \) -print0)
sign --options runtime --entitlements "$work/app.entitlements" -r="$(requirement "$bundle_id")" "$app"
codesign --verify --strict "$app"
echo "exported $app with $(basename "$profile") ($app_id)"
