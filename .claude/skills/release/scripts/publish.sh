#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: publish.sh <version> [--dry-run]}"
dry=0
[ "${2:-}" = --dry-run ] && dry=1
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
repo="mantrakp04/ardia"
dist="${RELEASE_DIST:-$root/dist/$version}"
dist_x64="${RELEASE_DIST_X64:-}"
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
arches=(arm64)
[ -z "$dist_x64" ] || arches+=(x86_64)
dist_of() { if [ "$1" = x86_64 ]; then echo "$dist_x64"; else echo "$dist"; fi; }
suffix_of() { if [ "$1" = x86_64 ]; then echo -x64; fi; }
feed_of() { echo "appcast$(suffix_of "$1").xml"; }
dmg_of() { echo "$(dist_of "$1")/Ardia-$version$(suffix_of "$1").dmg"; }
zip_of() { echo "$(dist_of "$1")/Ardia-$version$(suffix_of "$1").zip"; }
cli_of() { echo "$(dist_of "$1")/ardia-cli-$version-macos-$1.tar.gz"; }

assets=()
for arch in "${arches[@]}"; do
  feed="$(dist_of "$arch")/$(feed_of "$arch")"
  for file in "$(dmg_of "$arch")" "$(zip_of "$arch")" "$feed" "$(cli_of "$arch")" "$(cli_of "$arch").sha256"; do
    [ -f "$file" ] || die "no $file (scripts/release.sh $version --channel $channel --arch $arch first)"
    assets+=("$file")
  done
  item="$(awk -v v="$version" '/<item>/ { buf = "" } { buf = buf $0 "\n" } /<\/item>/ && buf ~ ("shortVersionString>" v "<") { print buf; exit }' "$feed")"
  [ -n "$item" ] || die "$feed has no item for $version"
  if [ "$channel" = nightly ]; then
    grep -q '<sparkle:channel>nightly</sparkle:channel>' <<<"$item" || die "$version's item in $feed isn't on the nightly channel"
  else
    ! grep -q '<sparkle:channel>' <<<"$item" || die "$version's item in $feed is on a channel, so stable copies would skip it"
  fi
done
[ -f "$dist/release-notes.md" ] || die "no $dist/release-notes.md"
for archive in "$dist"/ArdiaCore-*.tar.xz; do [ -f "$archive" ] && assets+=("$archive"); done
if ! git -C "$root" ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1; then
  [ "$dry" = 1 ] && echo "note: v$version isn't on origin yet (git tag v$version && git push origin main v$version)" \
    || die "push the tag first: git tag v$version && git push origin main v$version"
fi
stable_tag="$(gh release view -R "$repo" --json tagName -q .tagName)"
[[ "$stable_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the latest release is $stable_tag, not a stable one: the feed lives on the latest stable release"
published="$(gh release view "$stable_tag" -R "$repo" --json assets -q '.assets[].name')"

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-publish.XXXXXX")"
trap 'rm -rf "$work"' EXIT
for arch in "${arches[@]}"; do
  feed="$(feed_of "$arch")" arch_dist="$(dist_of "$arch")"
  source="$latest_url/$feed"
  grep -qx "$feed" <<<"$published" || { echo "note: $stable_tag has no $feed yet: $version starts it"; source=none; }
  if [ "$dry" = 1 ]; then
    mkdir -p "$work/$arch"
    cp "$arch_dist/$feed" "$work/$arch/"
    cp "$arch_dist/${feed%.xml}.built.xml" "$work/$arch/" 2>/dev/null || true
    arch_dist="$work/$arch"
  fi
  RELEASE_DIST="$arch_dist" APPCAST_NAME="$feed" "$here/appcast-merge.sh" "$version" "$source"
done

carried=""
if [ "$channel" = stable ] && [ -z "$dist_x64" ] && grep -qx appcast-x64.xml <<<"$published"; then
  echo "note: no Intel build in $version: its release carries $stable_tag's appcast-x64.xml unchanged, so Intel copies keep their feed"
  gh release download "$stable_tag" -R "$repo" -p appcast-x64.xml -D "$work"
  grep -q 'xmlns:sparkle' "$work/appcast-x64.xml" || die "$stable_tag's appcast-x64.xml isn't a Sparkle appcast"
  carried="$work/appcast-x64.xml"
  assets+=("$carried")
fi

if [ "$channel" = nightly ]; then
  release_flags=(--prerelease --latest=false)
else
  release_flags=(--latest)
fi
run gh release create "v$version" -R "$repo" "${release_flags[@]}" --verify-tag --title "Ardia $version" \
  --notes-file "$dist/release-notes.md" "${assets[@]}"
feeds=()
for arch in "${arches[@]}"; do feeds+=("$(dist_of "$arch")/$(feed_of "$arch")"); done
if [ "$channel" = nightly ]; then
  nightly_notes="The newest nightly, always as Ardia-Nightly.dmg (https://ardia.dev/nightly)${dist_x64:+, and Ardia-Nightly-x64.dmg for Intel Macs}. Now $version: its notes and source are at https://github.com/$repo/releases/tag/v$version. Every nightly's notes: https://ardia.dev/release-notes"
  if ! gh release view nightly -R "$repo" >/dev/null 2>&1; then
    run gh release create nightly -R "$repo" --prerelease --latest=false --title "Ardia Nightly" --notes "$nightly_notes"
  fi
  nightly_dmgs=()
  for arch in "${arches[@]}"; do
    cp -c "$(dmg_of "$arch")" "$work/Ardia-Nightly$(suffix_of "$arch").dmg"
    nightly_dmgs+=("$work/Ardia-Nightly$(suffix_of "$arch").dmg")
  done
  run gh release upload nightly -R "$repo" --clobber "${nightly_dmgs[@]}"
  run gh release edit nightly -R "$repo" --notes "$nightly_notes"
  run gh release upload "$stable_tag" -R "$repo" --clobber "${feeds[@]}"
fi

tap() { [ "${PUBLISH_TAP:-1}" = 0 ] && { echo "note: the Homebrew tap is left alone (PUBLISH_TAP=0): run update-tap.sh $version"; return 0; }; "$here/update-tap.sh" "$@"; }
[ "$dry" = 1 ] && { tap "$version" --dry-run || true; echo "dry run: nothing published"; exit 0; }
status=0
for arch in "${arches[@]}"; do
  feed="$(feed_of "$arch")"
  for url in "$latest_url/$feed" "https://ardia.dev/$feed"; do
    for _ in $(seq 1 18); do
      xml="$(curl -fsSL --max-time 20 "$url" 2>/dev/null || true)"
      grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && break
      sleep 10
    done
    grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && echo "PASS  $url lists $version" \
      || { echo "FAIL  $url lists $version"; status=1; }
  done
done
if [ -n "$carried" ]; then
  carried_xml="$(curl -fsSL --max-time 20 "$latest_url/appcast-x64.xml" 2>/dev/null || true)"
  [ "$carried_xml" = "$(cat "$carried")" ] && echo "PASS  $latest_url/appcast-x64.xml is still the Intel feed" \
    || { echo "FAIL  $latest_url/appcast-x64.xml is still the Intel feed"; status=1; }
fi
if [ "$channel" = nightly ]; then
  for arch in "${arches[@]}"; do
    dmg="$(dmg_of "$arch")" url="$nightly_url/Ardia-Nightly$(suffix_of "$arch").dmg"
    size="$(curl -fsSLI --max-time 30 "$url" | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
    [ "$size" = "$(stat -f %z "$dmg")" ] && echo "PASS  $url is $version's DMG" \
      || { echo "FAIL  $url is $version's DMG (size $size, expected $(stat -f %z "$dmg"))"; status=1; }
  done
  to="$(curl -s -o /dev/null --max-time 15 -w '%{redirect_url}' https://ardia.dev/nightly || true)"
  [ "$to" = "$nightly_url/Ardia-Nightly.dmg" ] && echo "PASS  https://ardia.dev/nightly leads there" \
    || { echo "FAIL  https://ardia.dev/nightly leads there (goes to ${to:-nothing}: deploy the site, infra/site/nginx.conf)"; status=1; }
fi
tap "$version" || { echo "FAIL  the Homebrew tap's cask is $version"; status=1; }
exit $status
