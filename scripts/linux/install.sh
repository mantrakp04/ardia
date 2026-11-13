#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: install.sh [--prefix DIR] [--destdir DIR]

Installs an extracted Ardia Linux package.

  --prefix DIR   absolute install prefix (default /usr)
  --destdir DIR  staging root for distribution packages (default none)

Ardia goes under PREFIX/lib/ardia with PREFIX/bin/ardia, its desktop entry
and icon. The polkit policy always goes to DESTDIR/usr/share/polkit-1/actions,
the only directory polkit reads actions from, whatever the prefix.
Without --destdir it must run as root, and installed files are owned by root.
USAGE
}

prefix=/usr
destdir=
while (($#)); do
  case "$1" in
    --prefix) prefix="${2:?--prefix needs a directory}"; shift 2 ;;
    --destdir) destdir="${2:?--destdir needs a directory}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

if [[ ! "$prefix" =~ ^/[A-Za-z0-9._/+-]*$ ]]; then
  echo "install.sh: --prefix must be an absolute path of letters, digits and ._/+-: $prefix" >&2
  exit 2
fi
if [[ "/$prefix/" == */../* ]]; then
  echo "install.sh: --prefix must not contain ..: $prefix" >&2
  exit 2
fi
prefix="${prefix%/}"
[[ -n "$prefix" ]] || prefix=/usr

if [[ -z "$destdir" && "$(id -u)" != 0 ]]; then
  echo "install.sh: installing into $prefix needs root (run it with sudo), or pass --destdir to stage it" >&2
  exit 1
fi

source_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for required in lib/ardia/chrome share/polkit-1/actions/dev.ardia.linux.policy share/applications/ardia.desktop; do
  if [[ ! -e "$source_root/$required" ]]; then
    echo "install.sh: $source_root is not an extracted Ardia package (missing $required)" >&2
    exit 1
  fi
done

target="$destdir$prefix"
install -d -m 0755 "$target/lib" "$target/bin" "$target/share/applications"
rm -rf "$target/lib/ardia"
cp -R --preserve=mode,timestamps,links "$source_root/lib/ardia" "$target/lib/ardia"
if [[ "$(id -u)" == 0 ]]; then
  chown -R 0:0 "$target/lib/ardia"
fi

launcher=$(mktemp)
trap 'rm -f "$launcher"' EXIT
printf '#!/usr/bin/env sh\nexec "%s/lib/ardia/chrome" "$@"\n' "$prefix" > "$launcher"
install -m 0755 "$launcher" "$target/bin/ardia"

sed "s|^Exec=ardia |Exec=$prefix/bin/ardia |" "$source_root/share/applications/ardia.desktop" > "$launcher"
install -m 0644 "$launcher" "$target/share/applications/ardia.desktop"

icon=share/icons/hicolor/256x256/apps/ardia.png
if [[ -f "$source_root/$icon" ]]; then
  install -D -m 0644 "$source_root/$icon" "$target/$icon"
fi

install -D -m 0644 "$source_root/share/polkit-1/actions/dev.ardia.linux.policy" \
  "$destdir/usr/share/polkit-1/actions/dev.ardia.linux.policy"
