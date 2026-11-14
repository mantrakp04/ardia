#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
name="ArdiaFairPlay"
bundle_id="${PRODUCT_BUNDLE_IDENTIFIER:-com.ardia.browser}.FairPlay"
helper="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/Helpers/$name.app"
work="${DERIVED_FILE_DIR:-$here/build}/fairplay"
identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
[ -z "$identity" ] && identity="-"
min_os="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
sources=("$here/main.swift")
binary="$work/$name"
mkdir -p "$work" "$helper/Contents/MacOS" "$helper/Contents/Resources"

stale=0
[ -f "$binary" ] || stale=1
for src in "${sources[@]}" "$0"; do [ "$src" -nt "$binary" ] && stale=1; done
if [ "$stale" = 1 ]; then
  echo "Building $name.app"
  slices=()
  for arch in ${ARCHS:-$(uname -m)}; do
    out="$work/$name-$arch"
    xcrun swiftc -O -module-name "$name" -target "$arch-apple-macos$min_os" \
      -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
      -framework AVFoundation -framework AppKit -framework MediaPlayer -o "$out" "${sources[@]}"
    slices+=("$out")
  done
  xcrun lipo -create "${slices[@]}" -output "$binary"
fi

cp "$binary" "$helper/Contents/MacOS/$name"
icon=""
app_resources="$TARGET_BUILD_DIR/${UNLOCALIZED_RESOURCES_FOLDER_PATH:-$CONTENTS_FOLDER_PATH/Resources}"
if [ -f "$app_resources/AppIcon.icns" ]; then
  cp "$app_resources/AppIcon.icns" "$helper/Contents/Resources/AppIcon.icns"
  icon="<key>CFBundleIconFile</key><string>AppIcon</string>"
fi
cat > "$helper/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Ardia</string>
  <key>CFBundleDisplayName</key><string>Ardia</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${MARKETING_VERSION:-1.0}</string>
  <key>CFBundleVersion</key><string>${CURRENT_PROJECT_VERSION:-1}</string>
  $icon
  <key>LSMinimumSystemVersion</key><string>$min_os</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
case "${EXPANDED_CODE_SIGN_IDENTITY_NAME:-}" in
  "Developer ID"*) timestamp=--timestamp ;;
  *) timestamp=--timestamp=none ;;
esac
codesign --force --sign "$identity" "$timestamp" --options runtime "$helper"
