#!/usr/bin/env bash
# Publishes one green Windows workflow run as the Windows alpha that the app updates from, on the GitHub prerelease
# windows-alpha (never latest): its two installers under this build's own names (Ardia-Setup-<cpu>-<build>.exe), the
# engine's source, then the feed windows-update.json that names those installers with their SHA-256, then the same
# installers under the names people download (Ardia-Setup-<cpu>.exe). The feed only ever names files that are
# already there and never change. The build before this one keeps its files, so an update the app offered from
# the last feed can still be downloaded; older builds' files go last.
#
#   scripts/windows/publish-alpha.sh [--dry-run] [--out <dir>] <Windows workflow run id>
#   scripts/windows/publish-alpha.sh -h | --help
#
# The build number is the run's number; Ardia.build.json inside the installer carries the same one.
# --dry-run downloads and packs into <dir> (default dist/windows-alpha-<build>), prints the gh commands and
# publishes nothing.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
repo="ardia-browser/ardia"
tag="windows-alpha"
published="https://github.com/$repo/releases/download/$tag"
die() { echo "error: $*" >&2; exit 1; }
dry=0 out="" run_id=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    --dry-run) dry=1 ;;
    --out) out="${2:?--out takes a directory}"; shift ;;
    -*) die "unknown option $1 (--help)" ;;
    *) run_id="$1" ;;
  esac
  shift
done
[ -n "$run_id" ] || die "which Windows workflow run? (--help)"
run() {
  printf '+'; printf ' %q' "$@"; echo
  [ "$dry" = 1 ] || "$@"
}

info="$(gh run view "$run_id" -R "$repo" --json workflowName,conclusion,headSha,number -q '[.workflowName, .conclusion, .headSha, (.number | tostring)] | @tsv')"
IFS=$'\t' read -r workflow conclusion commit build <<<"$info"
[ "$workflow" = Windows ] || die "run $run_id is the $workflow workflow, not Windows"
[ "$conclusion" = success ] || die "run $run_id ended $conclusion: only a green run is published"
git -C "$root" cat-file -e "$commit^{commit}" 2>/dev/null || git -C "$root" fetch -q origin "$commit" || die "commit $commit of run $run_id isn't in this checkout"
version="$(git -C "$root" show "$commit:apps/browser/macos/Ardia.xcodeproj/project.pbxproj" | sed -n 's/.*MARKETING_VERSION = "\{0,1\}\([^";]*\)"\{0,1\};.*/\1/p' | head -1)"
[ -n "$version" ] || die "no MARKETING_VERSION at $commit"

out="${out:-$root/dist/$tag-$build}"
rm -rf "$out" && mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
echo "==> Download the installers of run $run_id (build $build, $commit)"
for cpu in x64 arm64; do
  gh run download "$run_id" -R "$repo" -n "Ardia-Setup-$cpu" -D "$out/artifact-$cpu"
  [ -f "$out/artifact-$cpu/Ardia-Setup-$cpu.exe" ] || die "the Ardia-Setup-$cpu artifact holds no Ardia-Setup-$cpu.exe"
  mv "$out/artifact-$cpu/Ardia-Setup-$cpu.exe" "$out/Ardia-Setup-$cpu.exe"
  rm -rf "$out/artifact-$cpu"
done

echo "==> Feed"
python3 -I - "$out" "$published" "$version" "$build" <<'PY'
import hashlib, json, os, sys
out, published, version, build = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
feed = {"version": version, "build": build}
for cpu in ("x64", "arm64"):
    name = f"Ardia-Setup-{cpu}-{build}.exe"
    path = os.path.join(out, f"Ardia-Setup-{cpu}.exe")
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    feed[cpu] = {"url": f"{published}/{name}", "sha256": digest.hexdigest(), "bytes": os.path.getsize(path)}
with open(os.path.join(out, "windows-update.json"), "w") as file:
    json.dump(feed, file, indent=2)
    file.write("\n")
PY
cat "$out/windows-update.json"

echo "==> Source"
pin() { git -C "$root" show "$commit:scripts/windows/engine/helium-pins.ini" | awk -v section="[$1]" -v key="$2" '$0 == section { inside = 1; next } /^\[/ { inside = 0 } inside && $1 == key { print $3; exit }'; }
chromium="$(pin chromium version)"
helium="$(pin helium-chromium tag)"
helium_windows="$(pin helium-windows tag)"
[ -n "$chromium" ] && [ -n "$helium" ] && [ -n "$helium_windows" ] || die "scripts/windows/engine/helium-pins.ini at $commit pins no Chromium and Helium versions"
name="ardia-windows-source-$build"
src="$out/$name"
mkdir -p "$src"
fetch() {
  curl -fsSL --retry 3 --max-time 600 "https://codeload.github.com/imputnet/$1/tar.gz/refs/tags/$2" -o "$src/$1-$2.tar.gz" \
    || die "couldn't download imputnet/$1 at $2"
}
fetch helium-chromium "$helium"
fetch helium-windows "$helium_windows"
cat >"$src/README.txt" <<EOF
The source of Ardia for Windows, alpha build $build, besides Ardia's own repository.

Ardia, with the engine's patches and build scripts:
  https://github.com/$repo/tree/$commit
  How to build the engine: docs/engine-build-windows.md there. How to build the app: docs/windows.md.

Chromium $chromium (BSD-3-Clause and others):
  https://chromium.googlesource.com/chromium/src/+/refs/tags/$chromium
  https://commondatastorage.googleapis.com/chromium-browser-official/chromium-$chromium.tar.xz

Helium (GPL-3.0), copies of github.com/imputnet's tags:
  helium-chromium-$helium.tar.gz   its patches, domain substitution and build utilities
  helium-windows-$helium_windows.tar.gz   its Windows patches
EOF
tar -C "$out" -cf - "$name" | xz -T0 -9 >"$out/$name.tar.xz"
rm -rf "$src"

echo "==> Publish"
notes="$out/notes.md"
cat >"$notes" <<EOF
Ardia for Windows, alpha build $build ($version, commit $commit). For testing: expect rough edges.

- Intel or AMD PC: [Ardia-Setup-x64.exe]($published/Ardia-Setup-x64.exe)
- Snapdragon or other ARM PC: [Ardia-Setup-arm64.exe]($published/Ardia-Setup-arm64.exe)

The installer is not signed yet, so Windows shows "Windows protected your PC": choose More info, then Run anyway.
It installs for your user only, with no admin prompt. Once installed, Ardia checks this page for newer builds:
Settings, General, Updates, Check Now.

What works and what is known not to: https://github.com/$repo/pull/1116

The engine is Chromium $chromium with Helium's patches (GPL-3.0); $name.tar.xz is its source.
Not a Mac release.
EOF
if [ "$dry" = 1 ] || ! gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
  run gh release create "$tag" -R "$repo" --prerelease --latest=false --target "$commit" --title "Ardia for Windows (alpha)" --notes-file "$notes"
fi
before=""
[ "$dry" = 1 ] || before="$(gh release view "$tag" -R "$repo" --json assets -q '.assets[].name')"
for cpu in x64 arm64; do cp "$out/Ardia-Setup-$cpu.exe" "$out/Ardia-Setup-$cpu-$build.exe"; done
run gh release upload "$tag" -R "$repo" --clobber "$out/Ardia-Setup-x64-$build.exe" "$out/Ardia-Setup-arm64-$build.exe" "$out/$name.tar.xz"
run gh release upload "$tag" -R "$repo" --clobber "$out/windows-update.json"
run gh release upload "$tag" -R "$repo" --clobber "$out/Ardia-Setup-x64.exe" "$out/Ardia-Setup-arm64.exe"
run gh release edit "$tag" -R "$repo" --prerelease --latest=false --notes-file "$notes"
previous="$(printf '%s\n' "$before" | sed -n -E 's/^Ardia-Setup-(x64|arm64)-([0-9]+)\.exe$/\2/p' | grep -v -x "$build" | sort -n | tail -1 || true)"
for stale in $(printf '%s\n' "$before" | grep -E '^(Ardia-Setup-(x64|arm64)-[0-9]+\.exe|ardia-windows-source-[0-9]+\.tar\.xz)$' | grep -v -E -e "-($build${previous:+|$previous})\.(exe|tar\.xz)$" || true); do
  run gh release delete-asset "$tag" "$stale" -R "$repo" --yes
done
if [ "$dry" = 1 ]; then
  echo "dry run: nothing published."
else
  [ "$(gh release view "$tag" -R "$repo" --json isPrerelease -q .isPrerelease)" = true ] || die "$tag isn't a prerelease"
  echo "Published Windows alpha build $build: https://github.com/$repo/releases/tag/$tag"
fi
du -sh "$out/Ardia-Setup-x64.exe" "$out/Ardia-Setup-arm64.exe" "$out/$name.tar.xz"
