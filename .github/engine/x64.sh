#!/bin/bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
build="$repo/engine/patches/build"
cb="$HOME/chromium-build"
src="$cb/chromium_git/chromium/src"
out="$src/out/Release_GN_x64"
xcode=/Applications/Xcode_27.1.app
lockfile=/tmp/ac-chromium.lockf
job_minutes=350
reserve_minutes=50
min_build_minutes=10
ckpt="${RUNNER_TEMP:?}/checkpoint"
dist="${RUNNER_TEMP:?}/dist"

export AC_TARGET_CPU=x64 AC_FULL_PRIORITY=1
export PATH="/usr/bin:$PATH"
if [[ "${ENGINE_SCCACHE:-}" == true ]]; then
  export AC_GN_EXTRA_ARGS='cc_wrapper="sccache"' SCCACHE_GHA_ENABLED=true SCCACHE_GHA_VERSION=engine-x64 SCCACHE_IDLE_TIMEOUT=0
fi

say() { printf '\n==> %s (%s)\n' "$*" "$(date -u +%H:%M:%S)"; }
locked() { lockf -k "$lockfile" "$@"; }
output() { [[ -z "${GITHUB_OUTPUT:-}" ]] || echo "$1=$2" >>"$GITHUB_OUTPUT"; }
started() { cat "$RUNNER_TEMP/job-start"; }
pin() {
  python3 -c 'import configparser, sys; c = configparser.ConfigParser(interpolation=None); c.read(sys.argv[1]); print(c[sys.argv[2]][sys.argv[3]])' \
    "$build/helium-pins.ini" "$1" "$2"
}

setup() {
  date +%s >"$RUNNER_TEMP/job-start"
  say "disk before"
  df -h /
  sudo mdutil -a -i off >/dev/null || true
  [[ -d "$xcode" ]] || { echo "no $xcode on this image: pick the Xcode the local engine build uses" >&2; exit 1; }
  sudo xcode-select -s "$xcode/Contents/Developer"
  local keep x
  keep=$(cd "$xcode" && pwd -P)
  for x in /Applications/Xcode*; do
    [[ "$(cd "$x" 2>/dev/null && pwd -P)" == "$keep" ]] || sudo rm -rf "$x" &
  done
  sudo rm -rf "${ANDROID_HOME:-$HOME/Library/Android/sdk}" "$HOME/.dotnet" /usr/local/share/dotnet \
    "${AGENT_TOOLSDIRECTORY:-$HOME/hostedtoolcache}"/{CodeQL,go,Ruby,PyPy,node} &
  (xcrun simctl delete all; xcrun simctl runtime delete all) >/dev/null 2>&1 &
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --quiet coreutils xz brotli >/dev/null
  wait
  xcrun -f metal >/dev/null 2>&1 || xcodebuild -downloadComponent MetalToolchain
  say "disk after cleanup"
  df -h /
  xcodebuild -version
  xcrun --show-sdk-version
  python3 --version
  sysctl -n hw.ncpu hw.memsize machdep.cpu.brand_string
}

tools() {
  say "depot_tools"
  mkdir -p "$cb"
  git clone -q --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$cb/depot_tools"
  "$cb/depot_tools/ensure_bootstrap"
  say "Helium checkouts"
  local section dir
  for section in helium-chromium:helium helium-macos:helium-macos; do
    dir="$cb/${section#*:}"
    git init -q "$dir"
    git -C "$dir" fetch -q --depth 1 "$(pin "${section%%:*}" url)" "$(pin "${section%%:*}" commit)"
    git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  done
}

sync() {
  locked "$build/01-sync.sh" --apply
  df -h /
}

helium() {
  locked python3 "$build/03-helium.py" --apply --work "$cb/helium-work"
  rm -rf "$cb/helium-work"
}

series() {
  locked "$build/04-series.sh" --apply
}

gn_args() {
  locked "$build/02-gn-args.sh" --apply
  cat "$out/args.gn"
  rm -rf "$cb/series-base"
  df -h /
  du -sh "$src" "$out" "$cb/depot_tools" 2>/dev/null || true
}

restore() {
  say "restore the checkpoint"
  (cd "$ckpt" && shasum -a 256 -c checkpoint.sha256)
  mkdir -p "$cb"
  zstd -dc --long=27 "$ckpt/checkpoint.tar.zst" | tar -C "$cb" -xf -
  rm -rf "$ckpt"
  df -h /
}

build_phase() {
  local deadline now budget rc=0 limit="${ENGINE_PHASE_MINUTES:-0}"
  deadline=$(($(started) + (job_minutes - reserve_minutes) * 60))
  now=$(date +%s)
  budget=$((deadline - now))
  if [[ "$limit" =~ ^[0-9]+$ ]] && ((limit > 0 && limit * 60 < budget)); then budget=$((limit * 60)); fi
  if ((budget < min_build_minutes * 60)); then
    say "no time left to build in this phase: checkpoint now"
    output status running
    return 0
  fi
  [[ -z "${AC_GN_EXTRA_ARGS:-}" ]] || sccache --show-stats || true
  say "step 5: build for $((budget / 60)) min at most"
  gtimeout -k 10m -s TERM "$budget" lockf -k "$lockfile" "$build/05-build.sh" --apply || rc=$?
  [[ -z "${AC_GN_EXTRA_ARGS:-}" ]] || sccache --show-stats || true
  if ((rc == 0)); then
    say "chrome_framework built"
    output status finished
  elif ((rc == 124 || rc == 137)) || (($(date +%s) >= now + budget)); then
    say "phase time is up (exit $rc): checkpoint and resume in the next phase"
    output status running
  else
    say "the build failed (exit $rc)"
    exit "$rc"
  fi
}

checkpoint() {
  say "pack the checkpoint"
  rm -rf "$ckpt" && mkdir -p "$ckpt"
  tar --no-mac-metadata -C "$cb" -cf - chromium_git depot_tools | zstd -q -T0 -3 --long=27 -o "$ckpt/checkpoint.tar.zst"
  (cd "$ckpt" && shasum -a 256 checkpoint.tar.zst >checkpoint.sha256)
  ls -lh "$ckpt"
  df -h /
}

package() {
  local tree short archive
  tree=$(git -C "$repo" rev-parse HEAD:engine)
  short=${tree:0:12}
  say "Helium check"
  python3 "$build/helium-check-build.py" --out "$out" --brotli "$(command -v brotli)"
  lipo -archs "$out/Chromium Framework.framework/Versions/Current/Chromium Framework" | grep -qx x86_64 \
    || { echo "the framework isn't x86_64" >&2; exit 1; }
  say "pack ArdiaCore-$short-x64.tar.xz"
  rm -rf "$dist" && mkdir -p "$dist"
  archive="$dist/ArdiaCore-$short-x64.tar.xz"
  tar --no-mac-metadata -cf - -C "$out" "Chromium Framework.framework" | xz -T0 -9 >"$archive"
  (cd "$dist" && shasum -a 256 "${archive##*/}" >"${archive##*/}.sha256")
  cat "$archive.sha256"
  ls -lh "$dist"
}

case "${1:-}" in
  setup | tools | sync | helium | series | restore | checkpoint | package) "$1" ;;
  gn) gn_args ;;
  build) build_phase ;;
  *) echo "usage: x64.sh setup|tools|sync|helium|series|gn|restore|build|checkpoint|package" >&2; exit 64 ;;
esac
