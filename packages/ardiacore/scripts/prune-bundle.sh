#!/usr/bin/env bash
set -euo pipefail

usage="usage: prune-bundle.sh <Ardia.app>"
app="${1:?$usage}"
here="$(cd "$(dirname "$0")" && pwd)"
die() { echo "error: $*" >&2; exit 1; }
fwv="$(cd "$app/Contents/Frameworks/Chromium Framework.framework/Versions/Current" && pwd -P)" \
  || die "no Chromium Framework.framework in $app"
resources="$app/Contents/Resources"
enabled() { [ "${ARDIA_PRUNE:-on}" != off ] && [ "${!1:-on}" != off ]; }
bytes() { [ $# -eq 0 ] && { echo 0; return; }; find "$@" -type f -exec stat -f %z {} + | awk '{ s += $1 } END { print s + 0 }'; }
total=0
report() {
  total=$((total + $2))
  printf '    %-34s %6d KB  (%s)\n' "$1" $(($2 / 1024)) "$3"
}

languages=" en "
add_language() { [ -z "$1" ] || [[ "$languages" == *" ${1//-/_} "* ]] || languages+="${1//-/_} "; }
add_language "$(plutil -extract CFBundleDevelopmentRegion raw "$app/Contents/Info.plist" 2>/dev/null || true)"
declared="$(plutil -extract CFBundleLocalizations json -o - "$app/Contents/Info.plist" 2>/dev/null | tr -d '[]"' | tr ',' ' ' || true)"
for name in $declared; do
  [ -f "$fwv/Resources/${name//-/_}.lproj/locale.pak" ] \
    || die "Info.plist's CFBundleLocalizations has $name, but the framework has no ${name//-/_}.lproj/locale.pak"
  add_language "$name"
done
for lproj in "$resources"/*.lproj; do
  [ -d "$lproj" ] || continue
  name="$(basename "$lproj" .lproj)"
  [ "$name" = Base ] || add_language "$name"
done
ungendered() { local name="${1%_FEMININE}"; name="${name%_MASCULINE}"; echo "${name%_NEUTER}"; }

if enabled ARDIA_PRUNE_LOCALES; then
  [ -f "$fwv/Resources/en.lproj/locale.pak" ] || die "the framework has no en.lproj/locale.pak"
  doomed=()
  for lproj in "$fwv"/Resources/*.lproj; do
    [[ "$languages" == *" $(ungendered "$(basename "$lproj" .lproj)") "* ]] || doomed+=("$lproj")
  done
  freed="$(bytes ${doomed[@]+"${doomed[@]}"})"
  rm -rf ${doomed[@]+"${doomed[@]}"}
  report "Chrome locales" "$freed" "${#doomed[@]} dropped, $(echo $languages | wc -w | tr -d ' ') languages kept; ARDIA_PRUNE_LOCALES=off keeps all"
fi

if enabled ARDIA_PRUNE_SWIFTSHADER; then
  doomed=()
  for file in "$fwv/Libraries/libvk_swiftshader.dylib" "$fwv/Libraries/vk_swiftshader_icd.json" "$fwv/Libraries/libvulkan.dylib"; do
    [ -e "$file" ] && doomed+=("$file")
  done
  freed="$(bytes ${doomed[@]+"${doomed[@]}"})"
  rm -f ${doomed[@]+"${doomed[@]}"}
  report "SwiftShader and its Vulkan loader" "$freed" "ARDIA_PRUNE_SWIFTSHADER=off keeps them"
fi

if enabled ARDIA_PRUNE_FIRST_RUN; then
  freed="$(python3 -I - "$fwv/Resources/resources.pak" "$here/first-run-resources.sha256" <<'PY'
import hashlib, os, struct, sys
path, listing = sys.argv[1], sys.argv[2]
wanted = {line.split()[0] for line in open(listing) if line.strip()}
data = open(path, "rb").read()
if struct.unpack("<I", data[:4])[0] != 5:
    sys.exit("prune-bundle.sh: resources.pak isn't a version 5 pak")
count, aliases = struct.unpack("<HH", data[8:12])
table = [struct.unpack("<HI", data[12 + i * 6:18 + i * 6]) for i in range(count + 1)]
head = 12 + (count + 1) * 6 + aliases * 4
entries = [(table[i][0], data[table[i][1]:table[i + 1][1]]) for i in range(count)]
blanked = {rid for rid, blob in entries if hashlib.sha256(blob).hexdigest() in wanted}
offset, rows, body = head, bytearray(), bytearray()
for rid, blob in entries:
    rows += struct.pack("<HI", rid, offset)
    if rid not in blanked:
        body += blob
        offset += len(blob)
rows += struct.pack("<HI", 0, offset)
out = data[:12] + bytes(rows) + data[12 + (count + 1) * 6:head] + bytes(body)
check = [struct.unpack("<HI", out[12 + i * 6:18 + i * 6]) for i in range(count + 1)]
for i, (rid, blob) in enumerate(entries):
    got = out[check[i][1]:check[i + 1][1]]
    if check[i][0] != rid or got != (b"" if rid in blanked else blob):
        sys.exit(f"prune-bundle.sh: rewriting resources.pak changed resource {rid}")
tmp = path + ".prune"
open(tmp, "wb").write(out)
os.replace(tmp, path)
print(len(data) - len(out), len(blanked))
PY
)"
  read -r freed matched <<< "$freed"
  [ "$matched" -gt 0 ] || echo "    warning: none of first-run-resources.sha256 is in resources.pak (a new Chromium? rehash them)" >&2
  report "first-run sounds and art" "$freed" "$matched resources blanked; ARDIA_PRUNE_FIRST_RUN=off keeps them"
fi

ubo="$resources/Extensions/ublock"
if enabled ARDIA_PRUNE_UBO_LOCALES && [ -d "$ubo/_locales" ]; then
  default_locale="$(plutil -extract default_locale raw "$ubo/manifest.json" 2>/dev/null || echo en)"
  [ -f "$ubo/_locales/$default_locale/messages.json" ] || die "uBlock Origin has no _locales/$default_locale"
  lineages="$languages"
  for name in $languages; do
    [[ "$lineages" == *" ${name%%_*} "* ]] || lineages+="${name%%_*} "
  done
  doomed=()
  for dir in "$ubo"/_locales/*/; do
    name="$(basename "$dir")"
    [ "$name" = "$default_locale" ] || [[ "$lineages" == *" $name "* ]] || doomed+=("${dir%/}")
  done
  freed="$(bytes ${doomed[@]+"${doomed[@]}"})"
  rm -rf ${doomed[@]+"${doomed[@]}"}
  if [ -f "$resources/Extensions/ublock.fingerprint" ]; then
    (cd "$ubo" && find . -type f ! -path './_metadata/*' -print0 | LC_ALL=C sort -z \
      | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1) > "$resources/Extensions/ublock.fingerprint"
  fi
  report "uBlock Origin locales" "$freed" "${#doomed[@]} dropped; ARDIA_PRUNE_UBO_LOCALES=off keeps all"
fi

if enabled ARDIA_PRUNE_RN_3X && [ -d "$resources/assets" ]; then
  doomed=()
  while IFS= read -r -d '' image; do
    [ -f "${image/@3x./@2x.}" ] && doomed+=("$image")
  done < <(find "$resources/assets" -type f -name '*@3x.*' -print0)
  freed="$(bytes ${doomed[@]+"${doomed[@]}"})"
  rm -f ${doomed[@]+"${doomed[@]}"}
  report "@3x images" "$freed" "${#doomed[@]} dropped, Macs draw at 1x or 2x; ARDIA_PRUNE_RN_3X=off keeps them"
fi

hermes="$app/Contents/Frameworks/hermes.framework/Versions/Current/hermes"
if enabled ARDIA_STRIP_HERMES && [ -f "$hermes" ]; then
  uuid() { dwarfdump --uuid "$1" | awk '{ print $2 }'; }
  before_uuid="$(uuid "$hermes")" before_exports="$(dyld_info -exports "$hermes" | tail -n +2 | sort)"
  before="$(stat -f %z "$hermes")"
  strip -x "$hermes" 2>/dev/null
  [ "$(uuid "$hermes")" = "$before_uuid" ] || die "strip changed hermes's UUID"
  [ "$(dyld_info -exports "$hermes" | tail -n +2 | sort)" = "$before_exports" ] || die "strip changed what hermes exports"
  report "hermes local symbols" $((before - $(stat -f %z "$hermes"))) "re-sign hermes.framework; ARDIA_STRIP_HERMES=off keeps them"
fi

echo "    pruned $((total / 1048576)) MB"
