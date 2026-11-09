#!/bin/bash
set -euo pipefail
V=$(cd "$(dirname "$0")/.." && pwd); cd "$V"
id=$1; cut=${id%%-*}
wav="public/music/$cut.wav"
for w in public/music/*/"$id.wav"; do [ -f "$w" ] && wav=$w; done
pnpm exec remotion render "${VIDEOS_ENTRY:-src/index.ts}" "$id" "out/$id.render.mp4" --concurrency=6 --log=error
ffmpeg -v error -y -i "out/$id.render.mp4" -i "$wav" -map 0:v -map 1:a -c:v copy -c:a aac_at -b:a 320k -shortest \
  -movflags +faststart "out/$id.mp4"
rm "out/$id.render.mp4"
python3 scripts/check-sync.py "out/$id.mp4" "$wav"
