#!/bin/bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
name="${1:-Ardia}"
out="$here/DS_Store"
[ -z "${1:-}" ] || out="$here/DS_Store-$name"
tmp="$(mktemp -d)"
trap 'hdiutil detach "$tmp/mnt" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
run() { "$@" > "$tmp/log" 2>&1 || { cat "$tmp/log" >&2; echo "error: $1 failed" >&2; exit 1; }; }

[ ! -e "/Volumes/$name" ] || { echo "error: eject the mounted $name volume first" >&2; exit 1; }

py="$(PATH="/opt/homebrew/bin:$PATH" command -v python3)"
"$py" -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { echo "error: needs Python 3.10 or later (brew install python)" >&2; exit 1; }
"$py" -m venv "$tmp/venv"
run "$tmp/venv/bin/pip" install -q --disable-pip-version-check dmgbuild==1.6.7
mkdir -p "$tmp/$name.app" "$tmp/mnt"
cat > "$tmp/settings.py" <<EOF
files = ["$tmp/$name.app"]
symlinks = {"Applications": "/Applications"}
background = "$here/background.tiff"
window_rect = ((200, 160), (660, 384))
default_view = "icon-view"
show_icon_preview = False
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
arrange_by = None
label_pos = "bottom"
text_size = 13
icon_size = 112
icon_locations = {"$name.app": (176, 208), "Applications": (484, 208)}
EOF
run "$tmp/venv/bin/dmgbuild" -s "$tmp/settings.py" "$name" "$tmp/layout.dmg"
run hdiutil attach "$tmp/layout.dmg" -nobrowse -readonly -mountpoint "$tmp/mnt"
cp "$tmp/mnt/.DS_Store" "$out"
echo "$out"
