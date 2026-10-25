#!/bin/sh
# Builds the ardia CLI tarball: a relocatable CPython 3.13 with ardia_cli, its pinned dependencies and esbuild.
#
#   apps/cli/scripts/build.sh <version> <out dir> [arm64|x86_64]
#   apps/cli/scripts/build.sh -h | --help
#
# Writes <out dir>/ardia-cli-<version>-macos-<arch>.tar.gz (arm64 unless named) and its .sha256. Needs the network
# (python-build-standalone from GitHub, wheels and esbuild from npm) and uv (~/.local/bin/uv or on PATH); an x86_64
# build on Apple silicon runs its Python under Rosetta to check it. The Python and esbuild downloads are pinned by
# sha256 (esbuild also by npm's sha512 integrity) and cached in ~/Library/Caches/ardia-cli-build.
set -eu

python_release=20261013
python_version=3.13.16
esbuild_version=0.28.2

case ${1:-} in
  -h|--help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
esac
[ $# -eq 2 ] || [ $# -eq 3 ] || { sed -n '4,5p' "$0" | sed 's/^# *//' >&2; exit 64; }
version=$1
out=$2
arch=${3:-arm64}
case $arch in
  arm64)
    python_triple=aarch64-apple-darwin
    python_sha256=16a5332fb0dcb77f163fc8f8cbccd95be1644cc53e68e5d2a79f50afd6680a0e
    esbuild_platform=darwin-arm64
    esbuild_sha256=1980cde09749094452b20d36ff267585ccb3f72749c7bc97291cd9996ccf5a2a
    esbuild_sha512=n4KqkOQrraxHJcgjM1RvwbigfQKIKJVpM7xp+KsxiyUSrRdIXnt73VhrPAx0fV44hgfmIVKjxMN9J1t5jySVkw==
    ;;
  x86_64)
    python_triple=x86_64-apple-darwin
    python_sha256=f507ae04eb7747cd97cb484e8c5d83936cbfc52d9b08a1f35c00b47c707b1ae1
    esbuild_platform=darwin-x64
    esbuild_sha256=abb6a7a895aaf2cc0df36fecc3bf0042479ffec51a643a056d54e9109f27db55
    esbuild_sha512=uq6suIWYP37qzGddBKPw5QEQPi6HiLGsO7UmkpfyaYNQ3D+rN6w6WfwH+nuqcGXWvawGwxOEroO4YGnFh95azw==
    ;;
  *) echo "build.sh: arch is arm64 or x86_64, got $arch" >&2; exit 64 ;;
esac
python_asset=cpython-$python_version+$python_release-$python_triple-install_only_stripped.tar.gz
python_url=https://github.com/astral-sh/python-build-standalone/releases/download/$python_release/$(printf %s "$python_asset" | sed 's/+/%2B/')
esbuild_asset=esbuild-$esbuild_platform-$esbuild_version.tgz
esbuild_url=https://registry.npmjs.org/@esbuild/$esbuild_platform/-/$esbuild_platform-$esbuild_version.tgz
printf '%s\n' "$version" | grep -Eq '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-[a-z]{1,16}\.[0-9]{1,4})?$' \
  || { echo "build.sh: bad version: $version" >&2; exit 64; }

cli_dir=$(cd "$(dirname "$0")/.." && pwd)
uv=$(command -v uv 2>/dev/null || true)
[ -n "$uv" ] || uv=$HOME/.local/bin/uv
[ -x "$uv" ] || { echo "build.sh: uv not found" >&2; exit 1; }

cache=$HOME/Library/Caches/ardia-cli-build
mkdir -p "$cache" "$out"
out=$(cd "$out" && pwd)
if ! [ -f "$cache/$python_asset" ] || [ "$(shasum -a 256 "$cache/$python_asset" | awk '{ print $1 }')" != "$python_sha256" ]; then
  curl -fsSL --proto =https -o "$cache/$python_asset.part" "$python_url"
  mv "$cache/$python_asset.part" "$cache/$python_asset"
fi
actual=$(shasum -a 256 "$cache/$python_asset" | awk '{ print $1 }')
[ "$actual" = "$python_sha256" ] || { echo "build.sh: $python_asset checksum mismatch ($actual)" >&2; exit 1; }
if ! [ -f "$cache/$esbuild_asset" ] || [ "$(shasum -a 256 "$cache/$esbuild_asset" | awk '{ print $1 }')" != "$esbuild_sha256" ]; then
  curl -fsSL --proto =https -o "$cache/$esbuild_asset.part" "$esbuild_url"
  mv "$cache/$esbuild_asset.part" "$cache/$esbuild_asset"
fi
actual=$(shasum -a 256 "$cache/$esbuild_asset" | awk '{ print $1 }')
[ "$actual" = "$esbuild_sha256" ] || { echo "build.sh: $esbuild_asset checksum mismatch ($actual)" >&2; exit 1; }
actual=$(openssl dgst -sha512 -binary "$cache/$esbuild_asset" | base64)
[ "$actual" = "$esbuild_sha512" ] || { echo "build.sh: $esbuild_asset sha512 mismatch ($actual)" >&2; exit 1; }

work=$(mktemp -d "${TMPDIR:-/tmp}/ardia-cli-build.XXXXXX")
trap 'rm -rf "$work"' EXIT
root=$work/ardia-cli-$version
mkdir -p "$root/bin"
tar -xzf "$cache/$python_asset" -C "$root"
python=$root/python/bin/python3
pyver=$("$python" -I -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
lib=$root/python/lib/python$pyver
site=$lib/site-packages

UV_CACHE_DIR=$cache/uv "$uv" pip install --quiet --python "$python" --break-system-packages --link-mode copy \
  --no-build --require-hashes -r "$cli_dir/requirements.lock"
cp -R "$cli_dir/ardia_cli" "$site/ardia_cli"
printf '__version__ = "%s"\n' "$version" >"$site/ardia_cli/__init__.py"
mkdir "$work/esbuild" "$site/ardia_cli/bin"
tar -xzf "$cache/$esbuild_asset" -C "$work/esbuild" package/bin/esbuild
cp "$work/esbuild/package/bin/esbuild" "$site/ardia_cli/bin/esbuild"
chmod 755 "$site/ardia_cli/bin/esbuild"
rm -rf "$work/esbuild"
[ "$("$site/ardia_cli/bin/esbuild" --version)" = "$esbuild_version" ] || { echo "build.sh: the bundled esbuild doesn't run" >&2; exit 1; }
for binary in "$root/python/bin/python$pyver" "$site/ardia_cli/bin/esbuild"; do
  [ "$(lipo -archs "$binary")" = "$arch" ] || { echo "build.sh: $binary is $(lipo -archs "$binary"), not $arch" >&2; exit 1; }
done

rm -rf "$lib/test" "$lib/idlelib" "$lib/tkinter" "$lib/turtledemo" "$lib/ensurepip" "$lib/lib2to3" \
  "$lib/turtle.py" "$lib/pydoc_data" "$lib"/config-* "$lib/lib-dynload"/_tkinter* \
  "$site"/pip "$site"/pip-* \
  "$root/python/include" "$root/python/share" "$root/python/lib/pkgconfig" \
  "$root/python/lib"/tcl* "$root/python/lib"/tk* "$root/python/lib"/itcl* "$root/python/lib"/thread* \
  "$root/python/lib"/libtcl* "$root/python/lib"/libtk* \
  "$root/python/bin"/idle* "$root/python/bin"/pydoc* "$root/python/bin"/2to3* "$root/python/bin"/pip* \
  "$root/python/bin"/python*-config "$root/python/lib"/libpython*.dylib
find "$root/python/bin" -type f ! -name "python$pyver" -delete
find "$root" \( -name tests -o -name test \) -type d -path '*/site-packages/*' -prune -exec rm -rf {} +
find "$root" \( -name '*.pyc' -o -name '*.a' -o -name RECORD -o -name INSTALLER -o -name REQUESTED -o -name direct_url.json \) -type f -delete
find "$root" -type l | while IFS= read -r link; do
  case $(readlink "$link") in
    /*|..|../*|*/../*|*/..) rm -f "$link" ;;
  esac
done
"$python" -I -c 'import ardia_cli.cli, ardia_cli.scripts_cli, ardia_cli.scripts_test, ardia_cli.scripts_store, ardia_cli.browsing, pydoll, sqlite3, ssl, zoneinfo, ctypes, lzma; from ardia_cli.userscript import find_esbuild; assert find_esbuild().endswith("ardia_cli/bin/esbuild")' >/dev/null

cat >"$root/bin/ardia" <<'EOF'
#!/bin/sh
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname "$self")/$link ;;
  esac
done
root=$(cd -P "$(dirname "$self")/.." && pwd -P)
exec "$root/python/bin/python3" -I -m ardia_cli "$@"
EOF
chmod 755 "$root/bin/ardia"
mkdir "$root/.leases"
"$root/bin/ardia" --version >/dev/null
find "$root" -name __pycache__ -type d -prune -exec rm -rf {} +

tarball=ardia-cli-$version-macos-$arch.tar.gz
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --uid 0 --gid 0 --uname root --gname wheel \
  -czf "$out/$tarball.part" -C "$work" "ardia-cli-$version"
mv "$out/$tarball.part" "$out/$tarball"
(cd "$out" && shasum -a 256 "$tarball" >"$tarball.sha256")
printf '%s\n' "$out/$tarball"
