#!/bin/bash
# Render the Mac's intro music for Windows, from the Mac's own synthesis.
#
#   scripts/windows/render-intro-music.sh
#   scripts/windows/render-intro-music.sh -h | --help
#
# Compiles packages/shell/ios/IntroMusic.swift on this Mac with a small stand-in for ArdiaCore, renders it
# offline with the intro's cues (apps/browser/src/components/onboarding/introCues.ts) through the same reverb
# and volume the Mac plays, and writes apps/browser/windows/Ardia/IntroMusic.wav (16-bit stereo, 44.1 kHz)
# and IntroMusic.json (the cues it was rendered with and a SHA-256 of IntroMusic.swift and this script).
# windowsIntroMusic.test.mjs fails when either changes and the file was not rendered again. Needs macOS,
# swiftc, afconvert, shasum and node.
set -euo pipefail

help() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}
case "${1:-}" in -h | --help) help ;; esac

repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cues="$(cd "$repo/apps/browser" && node --no-warnings --import ./src/test-loader.mjs --input-type=module -e \
  "import { INTRO_CUES } from '$repo/apps/browser/src/components/onboarding/introCues.ts'; console.log(JSON.stringify(INTRO_CUES));")"

sed -e '/^import ArdiaCore$/d' \
  -e 's/LaunchConfig.shared.background && !LaunchConfig.shared.instanceFlag("allowAudio")/false/' \
  "$repo/packages/shell/ios/IntroMusic.swift" > "$work/IntroMusic.swift"
grep -q 'private static let silent: Bool = {' "$work/IntroMusic.swift"
if grep -q 'LaunchConfig' "$work/IntroMusic.swift"; then
  echo "render-intro-music: IntroMusic.swift uses LaunchConfig in a way this script doesn't stand in for" >&2
  exit 1
fi

cat > "$work/main.swift" <<'SWIFT'
import Foundation
let arguments = CommandLine.arguments
let data = arguments[1].data(using: .utf8)!
let cues = (try! JSONSerialization.jsonObject(with: data)) as! [String: Double]
guard let seconds = IntroMusic.render(cues: cues, to: arguments[2]) else { exit(1) }
print(seconds)
SWIFT

swiftc -O -o "$work/render" "$work/IntroMusic.swift" "$work/main.swift" -framework AVFoundation -framework QuartzCore
"$work/render" "$cues" "$work/raw.caf"
afconvert -f WAVE -d LEI16@44100 -c 2 "$work/raw.caf" "$repo/apps/browser/windows/Ardia/IntroMusic.wav"
source="$(cat "$repo/packages/shell/ios/IntroMusic.swift" "$repo/scripts/windows/render-intro-music.sh" | shasum -a 256 | cut -d' ' -f1)"
printf '{"cues":%s,"source":"%s"}\n' "$cues" "$source" > "$repo/apps/browser/windows/Ardia/IntroMusic.json"
ls -l "$repo/apps/browser/windows/Ardia/IntroMusic.wav"
