#!/usr/bin/env bash
# Sets up the release sign job's signing material on a GitHub macOS runner. The workflow removes it in its own
# always() step ("Remove signing"), so nothing the job writes can change what removes the keys.
#
#   .github/release/signing.sh setup     a temporary keychain with the Developer ID identity, the provisioning profile,
#                                        the notary key and the Sparkle key in $RUNNER_TEMP; exports only their paths to
#                                        $GITHUB_ENV (RELEASE_PROVISIONING_PROFILE, SPARKLE_KEY_FILE, NOTARY_KEY); the
#                                        step that signs passes NOTARY_KEY_ID and NOTARY_ISSUER itself
#
# Reads MACOS_CERTIFICATE_P12, MACOS_CERTIFICATE_PASSWORD, MACOS_PROVISIONING_PROFILE, SPARKLE_ED_PRIVATE_KEY and,
# when all three are set, NOTARY_KEY_P8, NOTARY_KEY_ID, NOTARY_ISSUER from the environment. Without the notary key it
# exports ALLOW_UNNOTARIZED=1 when ALLOW_MISSING_NOTARY=1 (a dry run), and fails otherwise.
set -euo pipefail

secrets="${RUNNER_TEMP:?}/release-signing"
keychain="$secrets/release.keychain-db"
die() { echo "::error::$*" >&2; exit 1; }

decode() { printf '%s' "$1" | base64 -D > "$2"; }

setup() {
  local missing=() name
  for name in MACOS_CERTIFICATE_P12 MACOS_CERTIFICATE_PASSWORD MACOS_PROVISIONING_PROFILE SPARKLE_ED_PRIVATE_KEY; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  [ ${#missing[@]} = 0 ] || die "missing secrets: ${missing[*]} (docs/releasing.md › CI releases)"
  rm -rf "$secrets"
  mkdir -p "$secrets" && chmod 700 "$secrets"

  local password
  password="$(openssl rand -hex 24)"
  echo "::add-mask::$password"
  security create-keychain -p "$password" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$password" "$keychain"
  local intermediate="$secrets/DeveloperIDG2CA.cer"
  curl -fsSL --retry 3 -o "$intermediate" https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
  [ "$(shasum -a 256 "$intermediate" | awk '{ print $1 }')" = f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a ] \
    || die "Apple's Developer ID G2 intermediate didn't match its pinned SHA-256"
  security import "$intermediate" -k "$keychain" -T /usr/bin/codesign >/dev/null || true

  local p12="$secrets/identity.p12"
  decode "$MACOS_CERTIFICATE_P12" "$p12"
  if ! security import "$p12" -k "$keychain" -f pkcs12 -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null 2>"$secrets/import.err"; then
    local openssl3
    openssl3="$(brew --prefix openssl@3 2>/dev/null)/bin/openssl"
    [ -x "$openssl3" ] || die "importing the certificate failed: $(cat "$secrets/import.err")"
    echo "the .p12 isn't in a format security reads; re-encoding it with OpenSSL 3's -legacy"
    PW="$MACOS_CERTIFICATE_PASSWORD" "$openssl3" pkcs12 -in "$p12" -passin env:PW -nodes \
      | PW="$MACOS_CERTIFICATE_PASSWORD" "$openssl3" pkcs12 -export -legacy -passout env:PW -out "$p12.legacy"
    security import "$p12.legacy" -k "$keychain" -f pkcs12 -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null \
      || die "importing the certificate failed, even re-encoded"
  fi
  rm -f "$p12" "$p12.legacy" "$secrets/import.err"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
  local others
  others="$(security list-keychains -d user | tr -d '"' | grep -v "^ *$keychain$" | xargs)"
  read -r -a others_list <<<"$others"
  security list-keychains -d user -s "$keychain" ${others_list[@]+"${others_list[@]}"}
  security find-identity -v -p codesigning "$keychain" | grep -q 'Developer ID Application: .*(U5L5T3NGVV)' \
    || die "the keychain has no valid Developer ID Application identity for U5L5T3NGVV: $(security find-identity -v -p codesigning "$keychain" | tail -1)"

  local profile="$secrets/ardia.provisionprofile"
  decode "$MACOS_PROVISIONING_PROFILE" "$profile"
  security cms -D -i "$profile" >/dev/null 2>&1 || die "MACOS_PROVISIONING_PROFILE isn't a base64 provisioning profile"

  local sparkle="$secrets/sparkle-key"
  (umask 077 && printf '%s' "$SPARKLE_ED_PRIVATE_KEY" > "$sparkle")

  {
    echo "RELEASE_PROVISIONING_PROFILE=$profile"
    echo "SPARKLE_KEY_FILE=$sparkle"
  } >> "$GITHUB_ENV"

  if [ -n "${NOTARY_KEY_P8:-}" ] && [ -n "${NOTARY_KEY_ID:-}" ] && [ -n "${NOTARY_ISSUER:-}" ]; then
    local notary="$secrets/AuthKey.p8"
    (umask 077 && decode "$NOTARY_KEY_P8" "$notary")
    grep -q 'BEGIN PRIVATE KEY' "$notary" || die "NOTARY_KEY_P8 isn't a base64 .p8 key"
    xcrun notarytool history --key "$notary" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" >/dev/null \
      || die "notarytool refuses NOTARY_KEY_P8, NOTARY_KEY_ID and NOTARY_ISSUER"
    echo "NOTARY_KEY=$notary" >> "$GITHUB_ENV"
  elif [ "${ALLOW_MISSING_NOTARY:-0}" = 1 ]; then
    echo "::warning::no notary secrets: this dry run isn't notarized"
    echo "ALLOW_UNNOTARIZED=1" >> "$GITHUB_ENV"
  else
    die "missing secrets: NOTARY_KEY_P8, NOTARY_KEY_ID and NOTARY_ISSUER"
  fi
}

case "${1:-}" in
  setup) setup ;;
  *) echo "usage: .github/release/signing.sh setup" >&2; exit 64 ;;
esac
