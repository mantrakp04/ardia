#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
has_key() {
  security find-generic-password -s https://sparkle-project.org -a "$1" >/dev/null 2>&1
}
account="${SPARKLE_ACCOUNT:-}"
if [ -n "$account" ]; then
  has_key "$account" || account=""
else
  legacy_account="$(sed -n 's/^ *public static let appName = "\(.*\)"$/\1/p' "$root/packages/sync/ios/Core/LegacyMigration.swift" | tr '[:upper:]' '[:lower:]')"
  for candidate in ardia $legacy_account; do
    if has_key "$candidate"; then account="$candidate"; break; fi
  done
fi
[ -n "$account" ] || {
  echo "error: no Sparkle EdDSA key in the login keychain under account ${SPARKLE_ACCOUNT:-ardia} (SPARKLE_ACCOUNT; docs/releasing.md)" >&2
  exit 1
}
echo "$account"
