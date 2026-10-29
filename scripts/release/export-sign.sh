#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/export-sign.sh <dist> <archive> <identity> <CLI tarball .sha256> [<provisioning profile>]"
dist="${1:?$usage}"
archive="${2:?$usage}"
identity="${3:?$usage}"
cli_sha="${4:?$usage}"
provisioning_profile="${5:-}"
. "$(dirname "$0")/lib.sh"
app="$dist/export/Ardia.app"

if [ -n "$provisioning_profile" ]; then
  app_entitlements="$macos/Ardia-macOS/Ardia.entitlements"
  grants_browser_passkeys "$provisioning_profile" && app_entitlements="$macos/Ardia-macOS/Ardia-ICloudPasskeys.entitlements"
  echo "==> Export (Developer ID, $(basename "$provisioning_profile"), $(basename "$app_entitlements"))"
  "$root/scripts/lib/export-developer-id.sh" "$archive/Products/Applications/Ardia.app" "$app" "$provisioning_profile" \
    "$app_entitlements" "$identity" com.ardia.browser > "$dist/export.log" 2>&1 || { cat "$dist/export.log" >&2; exit 1; }
else
  echo "==> Export (Developer ID)"
  for attempt in 1 2 3 4 5 6; do
    rm -rf "$dist/export"
    xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$macos/ExportOptions-DeveloperID.plist" \
      -exportPath "$dist/export" -allowProvisioningUpdates > "$dist/export.log" 2>&1 && break
    grep -q "A timestamp was expected" "$dist/export.log" && [ "$attempt" -lt 6 ] \
      || { cat "$dist/export.log" >&2; exit 1; }
    echo "    no timestamp from Apple (attempt $attempt), exporting again"
    sleep 10
  done
fi
[ "$(lipo -archs "$app/Contents/MacOS/Ardia")" = arm64 ] || die "the app's executable is $(lipo -archs "$app/Contents/MacOS/Ardia"), not arm64"

awk '{ print $1 }' "$cli_sha" >"$app/Contents/Resources/ardia-cli.sha256"

echo "==> Licenses"
licenses="$app/Contents/Resources/Licenses"
mkdir -p "$licenses"
cp "$root"/LICENSE* "$root/NOTICE" "$licenses/"

echo "==> Sign Chrome's framework"
entitlements_dir="$ardiacore/scripts/signing"
fw="$app/Contents/Frameworks/Chromium Framework.framework"
fwv="$(cd "$fw/Versions/Current" && pwd -P)" || die "no Chromium Framework.framework in the export"
"$ardiacore/scripts/strip-engine.sh" "$app" "$dist/symbols"
"$ardiacore/scripts/prune-bundle.sh" "$app"
for lib in "$fwv"/Libraries/*.dylib; do sign_as "$identity" "$lib"; done
for helper in "$fwv"/Helpers/*.app; do
  case "$(basename "$helper")" in
    *"Renderer).app") sign_as "$identity" --options restrict,kill,runtime --entitlements "$entitlements_dir/renderer.entitlements" "$helper" ;;
    *"GPU).app") sign_as "$identity" --options restrict,kill,runtime --entitlements "$entitlements_dir/gpu.entitlements" "$helper" ;;
    *) sign_as "$identity" --options restrict,library,kill,runtime "$helper" ;;
  esac
done
sign_as "$identity" --options restrict,library,kill,runtime "$fwv/Helpers/chrome_crashpad_handler"
sign_as "$identity" --options restrict,library,kill,runtime "$fwv/Helpers/app_mode_loader"
[ -e "$fwv/Helpers/web_app_shortcut_copier" ] && sign_as "$identity" --options restrict,library,kill,runtime \
  --identifier com.ardia.browser.web_app_shortcut_copier "$fwv/Helpers/web_app_shortcut_copier"
sign_as "$identity" "$fw"
[ -d "$app/Contents/Frameworks/hermes.framework" ] \
  && sign_as "$identity" --preserve-metadata=identifier,entitlements,flags,runtime "$app/Contents/Frameworks/hermes.framework"
sign_as "$identity" --preserve-metadata=entitlements,requirements,flags,runtime "$app"
