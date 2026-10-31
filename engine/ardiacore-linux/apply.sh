#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}
owned=(ardia/linux)
mode=${1:-}
case "$mode" in
  --paths) printf '%s\n' ardia/core/ac_hooks.h ardia/core/ac_content_hooks.h ardia/core/ac_launch_switches.h ardia/core/page_script.js; exit 0 ;;
  ''|--check) ;;
  *) echo "usage: $0 [--check|--paths]" >&2; exit 64 ;;
esac
if [[ "$mode" == --check ]]; then
  diff -r "$here/src/ardia/linux" "$src/ardia/linux" >/dev/null || { echo "drift: ardia/linux" >&2; exit 1; }
else
  mkdir -p "$src/ardia/linux"
  rsync -rlp --delete --checksum "$here/src/ardia/linux/" "$src/ardia/linux/"
fi
copy_file() {
  local source=$1 target=$2
  if [[ "$mode" == --check ]]; then
    cmp -s "$source" "$target" || { echo "drift: ${target#"$src/"}" >&2; exit 1; }
  else
    mkdir -p "${target%/*}"
    cmp -s "$source" "$target" || cp "$source" "$target"
  fi
}
copy_file "$here/../ardiacore/src/ardia/core/ac_hooks.h" "$src/ardia/core/ac_hooks.h"
copy_file "$here/../ardiacore/src/ardia/core/ac_content_hooks.h" "$src/ardia/core/ac_content_hooks.h"
copy_file "$here/../ardiacore/src/ardia/core/ac_launch_switches.h" "$src/ardia/core/ac_launch_switches.h"
copy_file "$here/../../packages/ardiacore/ios/page_script.js" "$src/ardia/core/page_script.js"
for file in "$here"/src/ardia/core/*; do
  copy_file "$file" "$src/ardia/core/${file##*/}"
done
