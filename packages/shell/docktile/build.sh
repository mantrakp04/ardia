#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
name="ArdiaDockTile"
bundle_id="${PRODUCT_BUNDLE_IDENTIFIER:-com.ardia.browser}.DockTilePlugIn"
plugin="$TARGET_BUILD_DIR/${PLUGINS_FOLDER_PATH:-$CONTENTS_FOLDER_PATH/PlugIns}/$name.plugin"
work="${DERIVED_FILE_DIR:-$here/build}/docktile"
identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
[ -z "$identity" ] && identity="-"
min_os="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
sources=("$here/DockTilePlugIn.swift" "$here/../ios/AppIcons.swift")
binary="$work/$name"
mkdir -p "$work" "$plugin/Contents/MacOS"

stale=0
[ -f "$binary" ] || stale=1
for src in "${sources[@]}" "$0"; do [ "$src" -nt "$binary" ] && stale=1; done
if [ "$stale" = 1 ]; then
  echo "Building $name.plugin"
  slices=()
  for arch in ${ARCHS:-$(uname -m)}; do
    out="$work/$name-$arch"
    xcrun swiftc -O -parse-as-library -module-name "$name" -target "$arch-apple-macos$min_os" \
      -sdk "$(xcrun --sdk macosx --show-sdk-path)" -Xlinker -bundle -emit-executable \
      -framework AppKit -framework CoreImage -o "$out" "${sources[@]}"
    slices+=("$out")
  done
  xcrun lipo -create "${slices[@]}" -output "$binary"
fi

cp "$binary" "$plugin/Contents/MacOS/$name"
cat > "$plugin/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>BNDL</string>
  <key>CFBundleShortVersionString</key><string>${MARKETING_VERSION:-1.0}</string>
  <key>CFBundleVersion</key><string>${CURRENT_PROJECT_VERSION:-1}</string>
  <key>LSMinimumSystemVersion</key><string>$min_os</string>
  <key>NSPrincipalClass</key><string>ArdiaDockTilePlugIn</string>
</dict>
</plist>
PLIST
case "${EXPANDED_CODE_SIGN_IDENTITY_NAME:-}" in
  "Developer ID"*) timestamp=--timestamp ;;
  *) timestamp=--timestamp=none ;;
esac
codesign --force --sign "$identity" "$timestamp" "$plugin"
