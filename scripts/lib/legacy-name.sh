#!/usr/bin/env bash
set -euo pipefail
key="${1:-}"
case "$key" in
  appFileName | appName | bundleId) ;;
  *) echo "usage: legacy-name.sh appFileName|appName|bundleId  (prints that constant from LegacyMigration.swift)" >&2; exit 64 ;;
esac
source_file="$(cd "$(dirname "$0")/../.." && pwd)/packages/sync/ios/Core/LegacyMigration.swift"
value="$(sed -n "s/^ *public static let $key = \"\(.*\)\"\$/\1/p" "$source_file")"
[ -n "$value" ] || { echo "error: can't read $key from $source_file" >&2; exit 1; }
printf '%s\n' "$value"
