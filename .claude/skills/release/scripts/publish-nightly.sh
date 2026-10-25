#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: publish-nightly.sh <version> [--dry-run]}"
dry=0
[ "${2:-}" = --dry-run ] && dry=1
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
repo="mantrakp04/ardia"
dist="${RELEASE_DIST:-$root/dist/$version}"
feed_url="https://github.com/$repo/releases/latest/download/appcast.xml"
nightly_dmg_url="https://github.com/$repo/releases/download/nightly/Ardia-Nightly.dmg"
die() { echo "error: $*" >&2; exit 1; }
run() {
  echo "+ $*"
  [ "$dry" = 1 ] || "$@"
}

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$ ]] || die "$version isn't a nightly version (<next stable>-nightly.<n>)"
dmg="$dist/Ardia-$version.dmg" zip="$dist/Ardia-$version.zip"
cli="$dist/ardia-cli-$version-macos-arm64.tar.gz"
for file in "$dmg" "$zip" "$dist/appcast.xml" "$dist/release-notes.md" "$cli" "$cli.sha256"; do
  [ -f "$file" ] || die "no $file (scripts/release.sh $version --channel nightly first)"
done
item="$(awk -v v="$version" '/<item>/ { buf = "" } { buf = buf $0 "\n" } /<\/item>/ && buf ~ ("shortVersionString>" v "<") { print buf; exit }' "$dist/appcast.xml")"
grep -q '<sparkle:channel>nightly</sparkle:channel>' <<<"$item" || die "$version's appcast item isn't on the nightly channel"
if ! git -C "$root" ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1; then
  [ "$dry" = 1 ] && echo "note: v$version isn't on origin yet (git tag v$version && git push origin main v$version)" \
    || die "push the tag first: git tag v$version && git push origin main v$version"
fi
stable_tag="$(gh release view -R "$repo" --json tagName -q .tagName)"
[[ "$stable_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the latest release is $stable_tag, not a stable one: the feed lives on the latest stable release"

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-publish-nightly.XXXXXX")"
trap 'rm -rf "$work"' EXIT
if [ "$dry" = 1 ]; then
  mkdir -p "$work/dist" && cp "$dist/appcast.xml" "$work/dist/" && cp "$dist/appcast.built.xml" "$work/dist/" 2>/dev/null || true
  RELEASE_DIST="$work/dist" "$here/appcast-merge.sh" "$version" "$feed_url"
else
  "$here/appcast-merge.sh" "$version" "$feed_url"
fi

engine=()
for archive in "$dist"/ArdiaCore-*.tar.xz; do [ -f "$archive" ] && engine+=("$archive"); done
run gh release create "v$version" -R "$repo" --prerelease --latest=false --verify-tag --title "Ardia $version" \
  --notes-file "$dist/release-notes.md" "$dmg" "$zip" "$dist/appcast.xml" "$cli" "$cli.sha256" ${engine[@]+"${engine[@]}"}
nightly_notes="The newest nightly, always as Ardia-Nightly.dmg (https://ardia.dev/nightly). Now $version: its notes and source are at https://github.com/$repo/releases/tag/v$version. Every nightly's notes: https://ardia.dev/release-notes"
if ! gh release view nightly -R "$repo" >/dev/null 2>&1; then
  run gh release create nightly -R "$repo" --prerelease --latest=false --title "Ardia Nightly" --notes "$nightly_notes"
fi
cp -c "$dmg" "$work/Ardia-Nightly.dmg"
run gh release upload nightly -R "$repo" --clobber "$work/Ardia-Nightly.dmg"
run gh release edit nightly -R "$repo" --notes "$nightly_notes"
run gh release upload "$stable_tag" -R "$repo" --clobber "$dist/appcast.xml"

[ "$dry" = 1 ] && { "$here/update-tap.sh" "$version" --dry-run || true; echo "dry run: nothing published"; exit 0; }
status=0
for _ in $(seq 1 18); do
  feed="$(curl -fsSL --max-time 20 "$feed_url" 2>/dev/null || true)"
  grep -q "<sparkle:shortVersionString>$version<" <<<"$feed" && break
  sleep 10
done
grep -q "<sparkle:shortVersionString>$version<" <<<"$feed" \
  && echo "PASS  the feed lists $version (on $stable_tag's appcast.xml)" || { echo "FAIL  the feed lists $version"; status=1; }
size="$(curl -fsSLI --max-time 30 "$nightly_dmg_url" | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
[ "$size" = "$(stat -f %z "$dmg")" ] && echo "PASS  $nightly_dmg_url is $version's DMG" \
  || { echo "FAIL  $nightly_dmg_url is $version's DMG (size $size, expected $(stat -f %z "$dmg"))"; status=1; }
to="$(curl -s -o /dev/null --max-time 15 -w '%{redirect_url}' https://ardia.dev/nightly || true)"
[ "$to" = "$nightly_dmg_url" ] && echo "PASS  https://ardia.dev/nightly leads there" \
  || { echo "FAIL  https://ardia.dev/nightly leads there (goes to ${to:-nothing}: deploy the site, infra/site/nginx.conf)"; status=1; }
"$here/update-tap.sh" "$version" || { echo "FAIL  the Homebrew tap's ardia@nightly is $version"; status=1; }
exit $status
