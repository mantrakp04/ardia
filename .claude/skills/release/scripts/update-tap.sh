#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: update-tap.sh <version> [--dry-run]}"
dry=0
[ "${2:-}" = --dry-run ] && dry=1
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
repo="mantrakp04/ardia"
tap="mantrakp04/homebrew-tap"
dist="${RELEASE_DIST:-$root/dist/$version}"
die() { echo "error: $*" >&2; exit 1; }

if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  cask="Casks/ardia.rb"
elif [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$ ]]; then
  cask="Casks/ardia@nightly.rb"
else
  die "$version is neither a stable nor a nightly version"
fi

dmg_name="Ardia-$version.dmg"
local_sum=""
[ -f "$dist/$dmg_name" ] && local_sum="$(shasum -a 256 "$dist/$dmg_name" | cut -d' ' -f1)"
published="$(gh release view "v$version" -R "$repo" --json assets \
  -q ".assets[] | select(.name == \"$dmg_name\") | .digest" 2>/dev/null || true)"
published="${published#sha256:}"
[ -n "$published" ] || [ "$dry" = 1 ] || die "v$version's release has no $dmg_name yet: publish it first"
[ -z "$published" ] || [ -z "$local_sum" ] || [ "$published" = "$local_sum" ] \
  || die "the published $dmg_name ($published) isn't $dist/$dmg_name ($local_sum)"
sum="${published:-$local_sum}"
[ -n "$sum" ] || die "no $dmg_name on v$version's release or in $dist"

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-tap.XXXXXX")"
trap 'rm -rf "$work"' EXIT
git clone -q --depth 1 "https://github.com/$tap.git" "$work/tap"
file="$work/tap/$cask"
[ -f "$file" ] || die "$tap has no $cask"
current="$(sed -n 's/^  version "\(.*\)"$/\1/p' "$file")"
[ -n "$current" ] || die "can't read the version in $tap's $cask"
if [ "$current" = "$version" ] && grep -qx "  sha256 \"$sum\"" "$file"; then
  echo "PASS  $tap's $cask is already $version"
  exit 0
fi
[ "$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -1)" = "$version" ] \
  || die "$tap's $cask is at $current, newer than $version"

sed -i '' -e "s/^  version \".*\"$/  version \"$version\"/" -e "s/^  sha256 \".*\"$/  sha256 \"$sum\"/" "$file"
changed="$(git -C "$work/tap" diff --numstat -- "$cask" | awk '{ print $1 "+" $2 }')"
[ "$changed" = "2+2" ] || [ "$current" = "$version" ] || die "expected the version and sha256 lines to change in $cask, got $changed"
git -C "$work/tap" --no-pager diff -- "$cask"
if [ "$dry" = 1 ]; then
  echo "dry run: $tap not pushed"
  exit 0
fi
git -C "$work/tap" commit -q -m "$(basename "$cask" .rb) $version" -- "$cask"
git -C "$work/tap" push -q origin HEAD:main
echo "PASS  $tap's $cask is $version (sha256 $sum)"
