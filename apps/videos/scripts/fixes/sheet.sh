#!/bin/bash
set -euo pipefail
S=${FIXES_SCRATCH:-$HOME/ardia-scratch/video-fixes}
name=$1; shift
offsets=${*:-"-0.4 0.4 1.2 2.4"}
out=$S/sheets/$name; mkdir -p "$out"; rm -f "$out"/*.png
for side in before after; do
  go=$(python3 -c "import json,sys; e=json.load(open('$S/footage/$side/$name.json'))['events']; print([x['t'] for x in e if x.get('mark')=='go'][0])")
  i=0
  for o in $offsets; do
    t=$(python3 -c "print(max(0,$go+$o))")
    ffmpeg -v error -y -ss "$t" -i "$S/footage/$side/$name.mov" -frames:v 1 -vf "scale=680:-1" "$out/$side-$i.png"
    i=$((i+1))
  done
done
n=$(echo $offsets | wc -w | tr -d ' ')
ffmpeg -v error -y -pattern_type glob -i "$out/after-*.png" -vf "tile=${n}x1" "$out/after.png"
ffmpeg -v error -y -pattern_type glob -i "$out/before-*.png" -vf "tile=${n}x1" "$out/before.png"
ffmpeg -v error -y -i "$out/before.png" -i "$out/after.png" -filter_complex vstack "$S/sheets/$name.png"
echo "$S/sheets/$name.png"
