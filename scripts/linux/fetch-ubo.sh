#!/usr/bin/env bash
set -euo pipefail
usage='usage: scripts/linux/fetch-ubo.sh

Prepares the uBlock Origin build Ardia ships as its content blocker by running
packages/ardiacore/scripts/ubo.sh with Linux stand-ins for lockf and shasum,
then prints the prepared extension directory for scripts/linux/package.py
--content-blocker.'
case "${1:-}" in
  -h|--help) echo "$usage"; exit 0 ;;
  '') ;;
  *) echo "$usage" >&2; exit 64 ;;
esac
repo=$(cd "$(dirname "$0")/../.." && pwd)
for tool in flock sha256sum curl unzip python3; do
  command -v "$tool" >/dev/null || { echo "fetch-ubo.sh: $tool is required" >&2; exit 69; }
done
shims=$(mktemp -d)
trap 'rm -rf "$shims"' EXIT
cat > "$shims/lockf" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
wait=600
while [ $# -gt 0 ]; do
  case "$1" in
    -k) shift ;;
    -t) wait=$2; shift 2 ;;
    *) break ;;
  esac
done
file=$1
shift
exec flock -w "$wait" "$file" "$@"
SH
cat > "$shims/shasum" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
while [ $# -gt 0 ]; do
  case "$1" in
    -a) shift 2 ;;
    *) break ;;
  esac
done
exec sha256sum "$@"
SH
chmod +x "$shims/lockf" "$shims/shasum"
PATH="$shims:$PATH" "$repo/packages/ardiacore/scripts/ubo.sh" >&2
ext="$repo/packages/ardiacore/vendor/ubo/ext"
[ -f "$ext/manifest.json" ] || { echo "fetch-ubo.sh: no uBlock Origin at $ext" >&2; exit 1; }
echo "$ext"
