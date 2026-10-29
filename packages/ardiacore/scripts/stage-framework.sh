#!/bin/bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
name="Chromium Framework"

key_of() {
  printf '%s %s %s' "$1" "$(stat -f '%m %z' "$1/Versions/Current/$name")" \
    "$(find "$1/Versions/Current/" -type f -exec stat -f '%m' {} + | sort -n | tail -1)" | shasum -a 256 | cut -c1-16
}
if [[ "${1:-}" == --key ]]; then
  key_of "$2"
  exit 0
fi

. "$repo/scripts/lib/paths.sh"
src=$chromium_framework
if [[ -z "${ARDIACORE_FRAMEWORK:-}" && ! -d "$src" ]]; then
  src=$("$here/fetch-engine.sh") || exit 1
fi
dest=${ARDIACORE_STAGE_DIR:-$repo/apps/browser/build-ardiacore/ArdiaCoreFramework}
cache=${ARDIACORE_STAGE_CACHE:-$repo/apps/browser/build-ardiacore/staged}

if [[ "${1:-}" == --publish ]]; then
  tmp=$2 key=$3
  if [[ -f "$cache/$key/.complete" ]]; then
    rm -rf "$tmp"
  else
    rm -rf "${cache:?}/$key"
    mv "$tmp" "$cache/$key"
  fi
  for old in "$cache"/*/; do
    old=${old%/}
    [[ -d "$old" ]] || continue
    [[ "${old##*/}" == "$key" ]] && continue
    [[ -n "$(find "$old" -maxdepth 0 -mmin -60)$(find "$old" -maxdepth 1 -name .used -mmin -60)" ]] || rm -rf "$old"
  done
  find "$cache" -mindepth 1 -maxdepth 1 -name '.tmp-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
  exit 0
fi

[[ -d "$src" ]] || { echo "error: no ArdiaCore framework at $src (engine/ardiacore/apply.sh, then build chrome_framework)" >&2; exit 1; }
stamp="$dest/.stamp"

fill_cache() {
  local tmp="$cache/.tmp-$$" key fwv lib helper
  rm -rf "$tmp" && mkdir -p "$tmp" || return 1
  echo "staging $src" >&2
  local copy=(bash -c '
    set -e
    "$3" --key "$1" >"$2/.key"
    cp -cR "$1" "$2/"' _ "$src" "$tmp" "$here/${0##*/}")
  if [[ "$src" == "$chromium_src/"* ]]; then
    "$repo/scripts/agent/locked" chromium --wait 500 -- "${copy[@]}" >&2 || return 1
  else
    "${copy[@]}" >&2 || return 1
  fi
  key=$(cat "$tmp/.key") || return 1
  sign() { codesign --force --timestamp=none --sign - "$@"; }
  fwv=$(cd "$tmp/$name.framework/Versions/Current" && pwd -P) || return 1
  for lib in "$fwv"/Libraries/*.dylib; do
    if [[ -e "$lib" ]]; then sign "$lib" || return 1; fi
  done
  for helper in "$fwv"/Helpers/*.app "$fwv"/Helpers/chrome_crashpad_handler "$fwv"/Helpers/app_mode_loader "$fwv"/Helpers/web_app_shortcut_copier; do
    if [[ -e "$helper" ]]; then sign "$helper" || return 1; fi
  done
  sign "$tmp/$name.framework" || return 1
  touch "$tmp/.complete" "$tmp/.used" || return 1
  lockf -k -t 120 "$cache/.lock" "$0" --publish "$tmp" "$key" >&2 || return 1
  echo "$key"
}

key=$(key_of "$src")
if [[ -f "$stamp" && "$(cat "$stamp")" == "$key" && -d "$dest/$name.framework" ]]; then
  exit 0
fi
mkdir -p "$cache" "$dest"
for attempt in 1 2 3; do
  if [[ ! -f "$cache/$key/.complete" ]]; then
    key=$(fill_cache) || { echo "error: staging ArdiaCore from $src failed" >&2; exit 1; }
  fi
  touch "$cache/$key/.used" 2>/dev/null || continue
  rm -rf "$dest/$name.framework.new"
  cp -cR "$cache/$key/$name.framework" "$dest/$name.framework.new" 2>/dev/null || continue
  rm -rf "$dest/$name.framework"
  mv "$dest/$name.framework.new" "$dest/$name.framework"
  echo "$key" >"$stamp"
  exit 0
done
echo "error: couldn't stage ArdiaCore from $cache (it kept changing under this build)" >&2
exit 1
