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
repo="mantrakp04/ardia"
dist="${RELEASE_DIST:-$root/dist/$version}"
latest_url="https://github.com/$repo/releases/latest/download"
nightly_url="https://github.com/$repo/releases/download/nightly"
die() { echo "error: $*" >&2; exit 1; }
run() {
  echo "+ $*"
  [ "$dry" = 1 ] || "$@"
}

if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$ ]]; then
  channel=nightly
elif [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  channel=stable
else
  die "$version is neither a stable (<major>.<minor>.<patch>) nor a nightly (<next stable>-nightly.<n>) version"
fi
dmg="$dist/Ardia-$version.dmg"
zip="$dist/Ardia-$version.zip"
feed="$dist/appcast.xml"
cli="$dist/ardia-cli-$version-macos-arm64.tar.gz"

assets=()
for file in "$dmg" "$zip" "$feed" "$cli" "$cli.sha256"; do
  [ -f "$file" ] || die "no $file (scripts/release.sh $version --channel $channel first)"
  assets+=("$file")
done
item="$(awk -v v="$version" '/<item>/ { buf = "" } { buf = buf $0 "\n" } /<\/item>/ && buf ~ ("shortVersionString>" v "<") { print buf; exit }' "$feed")"
[ -n "$item" ] || die "$feed has no item for $version"
if [ "$channel" = nightly ]; then
  grep -q '<sparkle:channel>nightly</sparkle:channel>' <<<"$item" || die "$version's item in $feed isn't on the nightly channel"
else
  ! grep -q '<sparkle:channel>' <<<"$item" || die "$version's item in $feed is on a channel, so stable copies would skip it"
fi
[ -f "$dist/release-notes.md" ] || die "no $dist/release-notes.md"
for archive in "$dist"/ArdiaCore-*.tar.xz; do [ -f "$archive" ] && assets+=("$archive"); done
if ! git -C "$root" ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1; then
  [ "$dry" = 1 ] && echo "note: v$version isn't on origin yet (git tag v$version && git push origin main v$version)" \
    || die "push the tag first: git tag v$version && git push origin main v$version"
fi
. "$here/publish-lock.sh"

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-publish.XXXXXX")"
trap 'release_lock; rm -rf "$work"' EXIT
trap 'exit 130' INT TERM HUP
take_lock "$version"
stable_tag="$(gh release view -R "$repo" --json tagName -q .tagName)"
[[ "$stable_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the latest release is $stable_tag, not a stable one: the feed lives on the latest stable release"
published="$(gh release view "$stable_tag" -R "$repo" --json assets -q '.assets[].name')"

if grep -qx appcast.xml <<<"$published"; then
  mkdir -p "$work/live"
  gh release download "$stable_tag" -R "$repo" -p appcast.xml -D "$work/live"
  source="$work/live/appcast.xml"
else
  echo "note: $stable_tag has no appcast.xml yet: $version starts it"
  source=none
fi
merge_dist="$dist"
if [ "$dry" = 1 ]; then
  mkdir -p "$work/dist"
  cp "$dist/appcast.xml" "$work/dist/"
  cp "$dist/appcast.built.xml" "$work/dist/" 2>/dev/null || true
  merge_dist="$work/dist"
fi
RELEASE_DIST="$merge_dist" "$here/appcast-merge.sh" "$version" "$source"
python3 -I - "$merge_dist/appcast.xml" "$version" <<'PY'
import re, sys
path, version = sys.argv[1:]
items = re.findall(r"<item>.*?</item>", open(path).read(), re.S)
def build_of(item):
    found = re.search(r"<sparkle:version>([0-9]+)</sparkle:version>", item)
    return int(found.group(1)) if found else None
mine = [build_of(i) for i in items if f"<sparkle:shortVersionString>{version}<" in i]
others = [build_of(i) for i in items if f"<sparkle:shortVersionString>{version}<" not in i and build_of(i) is not None]
if len(mine) != 1 or mine[0] is None:
    sys.exit(f"error: {path} has {len(mine)} items for {version}, not one")
if others and mine[0] <= max(others):
    sys.exit(f"error: {version} is build {mine[0]}, but the published feed already has build {max(others)}: a stale build would sit below it (and a stable would move latest backward); bump CURRENT_PROJECT_VERSION and rebuild")
print(f"PASS  {version} (build {mine[0]}) is above every other build in {path.rsplit('/', 1)[-1]} ({max(others) if others else 'none'})")
PY
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
run gh release create "v$version" -R "$repo" "${release_flags[@]}" --verify-tag --title "Ardia $version" \
  --notes-file "$dist/release-notes.md" "${assets[@]}"
if [ "$channel" = nightly ]; then
  nightly_notes="The newest nightly, always as Ardia-Nightly.dmg (https://ardia.dev/nightly). Now $version: its notes and source are at https://github.com/$repo/releases/tag/v$version. Every nightly's notes: https://ardia.dev/release-notes"
  if ! gh release view nightly -R "$repo" >/dev/null 2>&1; then
    run gh release create nightly -R "$repo" --prerelease --latest=false --title "Ardia Nightly" --notes "$nightly_notes"
  fi
  cp -c "$dmg" "$work/Ardia-Nightly.dmg"
  run gh release upload nightly -R "$repo" --clobber "$work/Ardia-Nightly.dmg"
  run gh release edit nightly -R "$repo" --notes "$nightly_notes"
  run gh release upload "$stable_tag" -R "$repo" --clobber "$feed"
fi

tap() { [ "${PUBLISH_TAP:-1}" = 0 ] && { echo "note: the Homebrew tap is left alone (PUBLISH_TAP=0): run update-tap.sh $version"; return 0; }; "$here/update-tap.sh" "$@"; }
[ "$dry" = 1 ] && { tap "$version" --dry-run || true; echo "dry run: nothing published"; exit 0; }
status=0
for url in "$latest_url/appcast.xml" "https://ardia.dev/appcast.xml"; do
  for _ in $(seq 1 18); do
    xml="$(curl -fsSL --max-time 20 "$url" 2>/dev/null || true)"
    grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && break
    sleep 10
  done
  grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && echo "PASS  $url lists $version" \
    || { echo "FAIL  $url lists $version"; status=1; }
done
if [ "$channel" = nightly ]; then
  url="$nightly_url/Ardia-Nightly.dmg"
  size="$(curl -fsSLI --max-time 30 "$url" | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
  [ "$size" = "$(stat -f %z "$dmg")" ] && echo "PASS  $url is $version's DMG" \
    || { echo "FAIL  $url is $version's DMG (size $size, expected $(stat -f %z "$dmg"))"; status=1; }
  to="$(curl -s -o /dev/null --max-time 15 -w '%{redirect_url}' https://ardia.dev/nightly || true)"
  [ "$to" = "$nightly_url/Ardia-Nightly.dmg" ] && echo "PASS  https://ardia.dev/nightly leads there" \
    || { echo "FAIL  https://ardia.dev/nightly leads there (goes to ${to:-nothing}: deploy the site, infra/site/nginx.conf)"; status=1; }
fi
tap "$version" || { echo "FAIL  the Homebrew tap's cask is $version"; status=1; }
exit $status
