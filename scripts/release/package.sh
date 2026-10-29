#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/package.sh <dist> <version> <identity>  (the update zip and the signed DMG of <dist>/export/Ardia.app)"
dist="${1:?$usage}"
version="${2:?$usage}"
identity="${3:?$usage}"
. "$(dirname "$0")/lib.sh"
app="$dist/export/Ardia.app"
dmg="$dist/Ardia-$version.dmg"

echo "==> Package"
legacy_app="$("$root/scripts/lib/legacy-name.sh" appFileName)"
update_dir="$dist/update"
rm -rf "$update_dir" && mkdir -p "$update_dir"
ditto "$app" "$update_dir/$legacy_app"
ditto -c -k --keepParent "$update_dir/$legacy_app" "$dist/Ardia-$version.zip"
rm -rf "$update_dir"
staging="$dist/dmg"
mkdir -p "$staging"
ditto "$app" "$staging/Ardia.app"
ln -s /Applications "$staging/Applications"
cp "$root/scripts/dmg/background.tiff" "$staging/.background.tiff"
cp "$root/scripts/dmg/DS_Store" "$staging/.DS_Store"
cp "$app/Contents/Resources/AppIcon.icns" "$staging/.VolumeIcon.icns"
mkdir -p "$staging/.fseventsd" && touch "$staging/.fseventsd/no_log"
dmg_rw="$dist/dmg-rw.dmg" dmg_mnt="$dist/dmg-mnt"
rm -rf "$dmg_rw" "$dmg_mnt" && mkdir "$dmg_mnt"
hdiutil create -volname Ardia -srcfolder "$staging" -format UDRW -ov "$dmg_rw" >/dev/null
rm -rf "$staging"
hdiutil attach "$dmg_rw" -nobrowse -noautoopen -noverify -mountpoint "$dmg_mnt" >/dev/null
SetFile -a C "$dmg_mnt" || { hdiutil detach "$dmg_mnt" -force >/dev/null; die "couldn't flag the volume's icon"; }
for attempt in 1 2 3 4 5; do
  hdiutil detach "$dmg_mnt" >/dev/null 2>&1 && break
  [ "$attempt" = 5 ] && { hdiutil detach "$dmg_mnt" -force >/dev/null || die "couldn't eject $dmg_mnt"; }
  sleep 2
done
dmg_chunks=(-imagekey udif-chunk-size=8192)
[ "${ARDIA_DMG_CHUNK:-on}" = off ] && dmg_chunks=()
hdiutil convert "$dmg_rw" -format ULMO ${dmg_chunks[@]+"${dmg_chunks[@]}"} -ov -o "$dmg" >/dev/null
rm -rf "$dmg_rw" "$dmg_mnt"
sign_as "$identity" "$dmg"
