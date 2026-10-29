#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/notes.sh <version> <notes body file> <min macOS> [--notarized] [--video <id>] [--engine-source <url>]  (prints the GitHub release notes)"
version="${1:?$usage}"
body="${2:?$usage}"
min_macos="${3:?$usage}"
shift 3
notarized=0
video=""
engine_source=""
while [ $# -gt 0 ]; do
  case "$1" in
    --notarized) notarized=1 ;;
    --video) video="${2:?$usage}"; shift ;;
    --engine-source) engine_source="${2:?$usage}"; shift ;;
    *) echo "error: unknown option $1 ($usage)" >&2; exit 1 ;;
  esac
  shift
done
. "$(dirname "$0")/lib.sh"

if [ "$(channel_of "$version")" = nightly ]; then
  updates_line="A nightly: every fix the day it lands, tested less than a stable release. It updates to newer nightlies and stables (Ardia › Check for Updates…); Settings › General › Update channel switches back to Stable, which never downgrades. Every release's notes: $RELEASE_NOTES_URL"
else
  updates_line="Earlier versions update automatically (Ardia › Check for Updates…). Every release's notes: $RELEASE_NOTES_URL"
fi
if [ "$notarized" = 1 ]; then
  install_line="Apple Silicon, macOS $min_macos or later. Signed with Developer ID and notarized by Apple: download, drag it to Applications, open it."
else
  install_line="Apple Silicon, macOS $min_macos or later. Signed with Developer ID but not notarized: on first launch macOS refuses to open it. Click Done, then System Settings › Privacy & Security › Open Anyway. Or run \`xattr -dr com.apple.quarantine /Applications/Ardia.app\`."
fi
source_line="This build's source, with the engine's patches and build scripts: $REPO_URL/tree/v$version (LICENSE and NOTICE there cover the licenses)."
[ -n "$engine_source" ] && source_line="$source_line The engine's Helium and uBlock sources as built, and where Chromium's is: $engine_source"
cat "$body"
[ -n "$video" ] && printf '\n## Before and after\n\nThe fixes, filmed on the previous release and on this one: %s\n' "${RELEASE_NOTES_URL%/release-notes}/release-videos/$video.mp4"
cat <<EOF

## Install

$install_line

$updates_line

## Source

$source_line
EOF
