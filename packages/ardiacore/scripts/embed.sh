#!/bin/bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
staged=${ARDIACORE_STAGE_DIR:-$repo/apps/browser/build-ardiacore/ArdiaCoreFramework}/"Chromium Framework.framework"
frameworks="$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH"
mkdir -p "$frameworks"
stamp="$DERIVED_FILE_DIR/ardiacore-embedded.stamp"
mkdir -p "$DERIVED_FILE_DIR"
identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
[ -z "$identity" ] && identity="-"
want="$(cat "$staged/../.stamp") $identity $(cat "$0" "$here"/signing/*.entitlements | shasum -a 256 | cut -c1-16)"
if ! [[ -f "$stamp" && "$(cat "$stamp")" == "$want" && -d "$frameworks/Chromium Framework.framework" ]]; then
  rm -rf "$frameworks/Chromium Framework.framework"
  cp -cR "$staged" "$frameworks/"
  if [ "$identity" != "-" ]; then
    sign() { codesign --force --timestamp=none --sign "$identity" "$@"; }
    fwv=$(cd "$frameworks/Chromium Framework.framework/Versions/Current" && pwd -P)
    for lib in "$fwv"/Libraries/*.dylib; do sign "$lib"; done
    for helper in "$fwv"/Helpers/*.app; do
      case "$(basename "$helper")" in
        *"Renderer).app") sign --options runtime --entitlements "$here/signing/renderer.entitlements" "$helper" ;;
        *"GPU).app") sign --options runtime --entitlements "$here/signing/gpu.entitlements" "$helper" ;;
        *) sign --options runtime "$helper" ;;
      esac
    done
    for tool in chrome_crashpad_handler app_mode_loader web_app_shortcut_copier; do
      [ -e "$fwv/Helpers/$tool" ] && sign --options runtime "$fwv/Helpers/$tool"
    done
    sign "$frameworks/Chromium Framework.framework"
  fi
  echo "$want" > "$stamp"
fi

"$here/unified-blocker.sh"
ubo="$repo/packages/ardiacore/vendor/unified-blocker/ext"
if [ -n "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ] && [ -f "$ubo/manifest.json" ]; then
  extensions="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Extensions"
  mkdir -p "$extensions"
  rm -rf "$extensions/ublock-lite" "$extensions/ublock-lite.fingerprint"
  rsync -a --delete "$ubo/" "$extensions/ublock/"
  (cd "$extensions/ublock" && find . -type f ! -path './_metadata/*' -print0 | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1) > "$extensions/ublock.fingerprint"
  rsync -a --delete "$repo/packages/ardiacore/extensions/ublock-lite-settings/" "$extensions/ublock-lite-settings/"
  rm -rf "$extensions/adnauseam"
fi
