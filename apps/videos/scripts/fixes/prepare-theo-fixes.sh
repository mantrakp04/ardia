#!/bin/bash
set -euo pipefail
V=$(cd "$(dirname "$0")/../.." && pwd)
S=${1:-$HOME/ardia-scratch}
O=$V/public/footage/theo-fixes
mkdir -p "$O"

clip() {
  local out=$1 src=$2 crop=$3; shift 3
  local graph="" labels="" n=0
  for part in "$@"; do
    IFS=: read -r from to speed <<<"$part"
    graph+="[0:v]trim=$from:$to,setpts=(PTS-STARTPTS)/${speed:-1},crop=$crop,fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[p$n];"
    labels+="[p$n]"; n=$((n + 1))
  done
  ffmpeg -v error -y -i "$src" -filter_complex "${graph}${labels}concat=n=$n:v=1[v]" -map "[v]" \
    -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p -an "$O/$out.mp4"
}

still() {
  ffmpeg -v error -y -i "$2" -vf "$3" -frames:v 1 "$O/$1.png"
}

slides() {
  local out=$1 hold=$2 size=$3; shift 3
  local inputs=() graph="" labels="" n=0
  for f in "$@"; do
    inputs+=(-loop 1 -t "$hold" -i "$f")
    graph+="[$n:v]scale=$size:force_original_aspect_ratio=decrease,pad=$size:(ow-iw)/2:(oh-ih)/2:color=0x1b1a1a,fps=30,setsar=1,format=yuv420p[s$n];"
    labels+="[s$n]"; n=$((n + 1))
  done
  ffmpeg -v error -y "${inputs[@]}" -filter_complex "${graph}${labels}concat=n=$n:v=1[v]" -map "[v]" \
    -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p "$O/$out.mp4"
}

VID=$S/videos
R=$S/stills/onboarding-redo
M=$S/sitemenu/shots
B=$VID/unread-badge-before-after.png

clip helium-before "$VID/issue-1146-helium-import-before-after.mp4" 880:562:240:150 0.4:3.4
clip helium-after "$VID/issue-1146-helium-import-before-after.mp4" 880:562:240:150 4.0:8.5

clip glass-before "$VID/onboarding-glass-classic-before-after.mp4" 1280:740:0:120 0.5:5.0
clip glass-after "$VID/onboarding-glass-classic-before-after.mp4" 1280:740:0:120 16.5:21.0

clip short-before "$VID/onboarding-shorter-redo-before-after.mp4" 880:562:240:150 0.2:16.9:3.7
still short-redo-row "$R/v2/settings-redo-row-when-default.png" "crop=1230:300:420:20"
still short-step1 "$R/after-1-source.png" crop=1764:1124:478:298
still short-step2 "$R/v2/look-glass-tint-dark-def.png" crop=1764:1124:478:298
still short-step3 "$R/v2/done-first-run-def.png" crop=1764:1124:478:298
slides short-after 1.125 1764:1124 "$O/short-step1.png" "$O/short-step2.png" "$O/short-step3.png" "$O/short-redo-row.png"

clip tabs-before "$VID/tab-mousedown-before-after.mp4" 702:634:0:112 0:6.73:1.6
clip tabs-after "$VID/tab-mousedown-before-after.mp4" 702:634:702:112 0:6.73:1.6

clip urlbar-before "$VID/urlbar-inline-before-after.mp4" 1190:330:170:100 0.9:2.8
clip urlbar-after "$VID/urlbar-inline-before-after.mp4" 1190:330:170:100 5.4:9.6

clip newtab-before "$VID/newtab-row-highlight-before-after.mp4" 560:360:0:60 7.0:11.5
clip newtab-after "$VID/newtab-row-highlight-before-after.mp4" 560:360:800:60 7.0:11.5

clip channel-before "$VID/channel-switch-check-before-after.mp4" 1150:205:470:782 0.8:5.3
clip channel-after "$VID/channel-switch-check-before-after.mp4" 1150:205:470:782 19.8:24.3

for side in before:24 after:428; do
  IFS=: read -r name x <<<"$side"
  ffmpeg -v error -y -i "$B" -filter_complex \
    "[0]crop=380:90:$x:160[dp];[0]crop=380:440:$x:515[dr];[0]crop=380:90:$((x + 807)):160[lp];[0]crop=380:440:$((x + 807)):515[lr];[dp][dr]vstack[d];[lp][lr]vstack[l];[d]pad=iw+24:ih:0:0:color=0xF1ECE2[dd];[dd][l]hstack" \
    -frames:v 1 "$O/badge-$name.png"
done

for pair in before:real-prefix-right-glass-dark-white after:real-new-right-glass-dark-white; do
  IFS=: read -r name file <<<"$pair"
  still "sitemenu-$name" "$M/$file.png" "drawbox=x=2476:y=104:w=172:h=44:color=0x57474a:t=fill,crop=2720:440:0:0"
done

clip search-before "$VID/settings-search-before-after.mp4" 960:590:0:50 0:3.5
clip search-after "$VID/settings-search-before-after.mp4" 960:590:960:50 0:3.5

clip little-before "$VID/little-ardia-setting-off-before-after.mp4" 1320:700:300:150 0.6:2.0 3.2:5.0
clip little-after "$VID/little-ardia-setting-off-before-after.mp4" 1320:700:300:150 10.7:12.1 13.4:15.2

echo "theo-fixes footage → $O"
