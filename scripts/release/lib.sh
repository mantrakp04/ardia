root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
. "$root/scripts/lib/releases.sh"
macos="$root/apps/browser/macos"
ardiacore="$root/packages/ardiacore"

die() { echo "error: $*" >&2; exit 1; }

load_notary_auth() {
  local profile="${NOTARY_PROFILE:-ardia}"
  [ -f "$root/scripts/.notary.env" ] && . "$root/scripts/.notary.env"
  if [ -n "${NOTARY_KEY:-}" ]; then
    notary_auth=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
  else
    notary_auth=(--keychain-profile "$profile")
  fi
}

sign_as() {
  local identity="$1" attempt
  shift
  for attempt in 1 2 3 4 5; do
    codesign --force --timestamp --sign "$identity" "$@" && return 0
    echo "    signing failed (attempt $attempt), likely no timestamp from Apple; retrying" >&2
    sleep 5
  done
  die "couldn't sign ${*: -1}"
}

grants_browser_passkeys() {
  security cms -D -i "$1" 2>/dev/null \
    | plutil -extract 'Entitlements.com\.apple\.developer\.web-browser\.public-key-credential' raw -o - - 2>/dev/null | grep -qx true
}
