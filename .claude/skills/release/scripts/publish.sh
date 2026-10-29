#!/usr/bin/env bash
set -euo pipefail

usage="usage: publish.sh <version> [--dry-run] [--break-lock]"
version="${1:?$usage}"
shift
dry=0
break_lock=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --break-lock) break_lock=1 ;;
    *) echo "error: unknown option $arg ($usage)" >&2; exit 1 ;;
  esac
done
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
. "$root/scripts/lib/releases.sh"
dist="${RELEASE_DIST:-$root/dist/$version}"
die() { echo "error: $*" >&2; exit 1; }
run() {
  echo "+ $*"
  [ "$dry" = 1 ] || "$@"
}

channel="$(channel_of "$version")"
dmg="$dist/Ardia-$version.dmg"
zip="$dist/Ardia-$version.zip"
feed="$dist/appcast.xml"
cli="$dist/ardia-cli-$version-macos-arm64.tar.gz"

assets=()
for file in "$dmg" "$zip" "$feed" "$cli" "$cli.sha256"; do
  [ -f "$file" ] || die "no $file (scripts/release.sh $version first)"
  assets+=("$file")
done
item_channel="$(appcast channel "$feed" "$version")"
[ "$item_channel" = "$channel" ] || die "$version's item in $feed is on the $item_channel channel, not $channel"
[ -f "$dist/release-notes.md" ] || die "no $dist/release-notes.md"
if ! git -C "$root" ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1; then
  [ "$dry" = 1 ] && echo "note: v$version isn't on origin yet (git tag v$version && git push origin main v$version)" \
    || die "push the tag first: git tag v$version && git push origin main v$version"
fi
. "$here/publish-lock.sh"

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-publish.XXXXXX")"
trap 'release_lock; rm -rf "$work"' EXIT
trap 'exit 130' INT TERM HUP
take_lock "$version" "$dry" "$break_lock"
stable_tag="$(latest_stable_tag)"

built="$dist/appcast.built.xml"
[ -f "$built" ] || cp "$feed" "$built"
merged="$feed"
[ "$dry" = 1 ] && merged="$work/appcast.xml"
if download_live_feed "$stable_tag" "$work/live"; then
  appcast merge "$work/live/appcast.xml" "$built" "$version" "$merged"
else
  echo "note: $stable_tag has no appcast.xml yet: $version starts it"
  cp "$built" "$merged"
fi
appcast check-above "$merged" "$version"
if [ "$channel" = stable ]; then
  latest_version="${stable_tag#v}"
  [ "$version" != "$latest_version" ] && [ "$(printf '%s\n%s\n' "$latest_version" "$version" | sort -V | tail -1)" = "$version" ] \
    || die "$version isn't above the latest stable release ($latest_version): publishing it as latest would move every download and feed backward"
  echo "PASS  $version is above the latest stable release ($latest_version)"
fi

if [ "$channel" = nightly ]; then
  release_flags=(--prerelease --latest=false)
else
  release_flags=(--latest)
fi
run gh release create "v$version" -R "$REPO" "${release_flags[@]}" --verify-tag --title "Ardia $version" \
  --notes-file "$dist/release-notes.md" "${assets[@]}"
if [ "$channel" = nightly ]; then
  nightly_notes="The newest nightly, always as Ardia-Nightly.dmg (https://ardia.dev/nightly). Now $version: its notes and source are at $REPO_URL/releases/tag/v$version. Every nightly's notes: $RELEASE_NOTES_URL"
  if ! gh release view nightly -R "$REPO" >/dev/null 2>&1; then
    run gh release create nightly -R "$REPO" --prerelease --latest=false --title "Ardia Nightly" --notes "$nightly_notes"
  fi
  cp -c "$dmg" "$work/Ardia-Nightly.dmg"
  run gh release upload nightly -R "$REPO" --clobber "$work/Ardia-Nightly.dmg"
  run gh release edit nightly -R "$REPO" --notes "$nightly_notes"
  run gh release upload "$stable_tag" -R "$REPO" --clobber "$feed"
fi

tap() { [ "${PUBLISH_TAP:-1}" = 0 ] && { echo "note: the Homebrew tap is left alone (PUBLISH_TAP=0): run update-tap.sh $version"; return 0; }; "$here/update-tap.sh" "$@"; }
[ "$dry" = 1 ] && { tap "$version" --dry-run || true; echo "dry run: nothing published"; exit 0; }
status=0
for url in "$LATEST_DOWNLOAD_URL/appcast.xml" "https://ardia.dev/appcast.xml"; do
  for _ in $(seq 1 18); do
    xml="$(curl -fsSL --max-time 20 "$url" 2>/dev/null || true)"
    grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && break
    sleep 10
  done
  grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && echo "PASS  $url lists $version" \
    || { echo "FAIL  $url lists $version"; status=1; }
done
if [ "$channel" = nightly ]; then
  url="$NIGHTLY_DMG_URL"
  size="$(curl -fsSLI --max-time 30 "$url" | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
  [ "$size" = "$(stat -f %z "$dmg")" ] && echo "PASS  $url is $version's DMG" \
    || { echo "FAIL  $url is $version's DMG (size $size, expected $(stat -f %z "$dmg"))"; status=1; }
  to="$(curl -s -o /dev/null --max-time 15 -w '%{redirect_url}' https://ardia.dev/nightly || true)"
  [ "$to" = "$NIGHTLY_DMG_URL" ] && echo "PASS  https://ardia.dev/nightly leads there" \
    || { echo "FAIL  https://ardia.dev/nightly leads there (goes to ${to:-nothing}: deploy the site, infra/site/nginx.conf)"; status=1; }
fi
tap "$version" || { echo "FAIL  the Homebrew tap's cask is $version"; status=1; }
exit $status
