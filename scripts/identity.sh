ac_identity_project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/apps/browser/macos/Ardia.xcodeproj"
ac_identity_settings="$(xcodebuild -showBuildSettings -project "$ac_identity_project" -target Ardia-macOS -configuration Release 2>/dev/null)" \
  || { echo "error: couldn't read the app's identity from $ac_identity_project (xcodebuild -showBuildSettings)" >&2; exit 1; }
ac_identity() { sed -n "s/^ *$1 = //p" <<<"$ac_identity_settings" | head -1; }
