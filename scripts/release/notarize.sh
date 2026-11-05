#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/notarize.sh <Ardia.app or .dmg> <log dir>  (notarizes it and staples the ticket to it)"
target="${1:?$usage}"
logs="${2:?$usage}"
. "$(dirname "$0")/lib.sh"
load_notary_auth

submit() {
  echo "Notarizing $(basename "$1")"
  local log="$logs/notary-$(basename "$1").log" id="" attempt tries=0
  : > "$log"
  for attempt in 1 2 3; do
    if xcrun notarytool submit "$1" "${notary_auth[@]}" | tee "$log.submit"; then
      id="$(awk '$1 == "id:" { print $2; exit }' "$log.submit")"
    fi
    cat "$log.submit" >> "$log"
    rm "$log.submit"
    [ -z "$id" ] || break
    [ "$attempt" = 3 ] || { echo "notarytool submit failed (attempt $attempt), likely an upload cut off; submitting again"; sleep 20; }
  done
  [ -n "$id" ] || die "notarytool couldn't submit $(basename "$1") (3 attempts)"
  until xcrun notarytool wait "$id" "${notary_auth[@]}" --timeout 1h | tee -a "$log" | grep -q "status: Accepted"; do
    grep -Eq "status: (Invalid|Rejected)" "$log" && die "notarization failed: xcrun notarytool log $id"
    tries=$((tries + 1))
    [ "$tries" -lt 5 ] || die "notarytool kept failing while waiting on $id"
    echo "notarytool wait failed; asking again ($tries/5)"
    sleep 20
  done
}

case "$target" in
  *.app)
    ditto -c -k --keepParent "$target" "$logs/notarize.zip"
    submit "$logs/notarize.zip"
    rm "$logs/notarize.zip"
    ;;
  *.dmg) submit "$target" ;;
  *) die "$usage" ;;
esac
xcrun stapler staple "$target"
