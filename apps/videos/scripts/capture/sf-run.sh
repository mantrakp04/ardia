#!/bin/bash
set -euo pipefail
APP=$1; SCRATCH=$2; shift 2
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../../.." && pwd)
STEPS=${*:-setup share add drop back rename reorder sub}
SITES_PORT=47410
A=$SCRATCH/priya; B=$SCRATCH/tomas; SHARED=$SCRATCH/shared
AC="$REPO/scripts/agent/ac"
curl -fs -o /dev/null -H "Host: canopy.example" "http://127.0.0.1:$SITES_PORT/" || { node "$HERE/sites/serve.mjs" $SITES_PORT >/dev/null 2>&1 & sleep 1; }
up() {
  local who=$1 data=$2 port=$3
  if [ -f "$data/instance.json" ] && "$AC" status "$data" >/dev/null 2>&1; then return; fi
  mkdir -p "$SCRATCH/import-empty" "$SHARED"
  node "$HERE/sf-session.mjs" "$SCRATCH/$who-session.json" "$who"
  "$AC" launch "$APP" --data "$data" --port "$port" --onboarded --session "$SCRATCH/$who-session.json" \
    --instance sharedFolders="$SHARED" --instance importSourceDir="$SCRATCH/import-empty" \
    --instance importSafariHome="$SCRATCH/import-empty" --test appMenu --test appDialog \
    --switch "--host-resolver-rules=MAP *.example 127.0.0.1:$SITES_PORT"
}
up priya "$A" 47401 &
up tomas "$B" 47402 &
wait
sleep 4
cap() { node "$HERE/sf-cap.mjs" "$1" "$2"; }
pair() { cap "$1" "$2" & local w=$!; sleep 3; cap "$3" "$4"; wait $w; }
for s in $STEPS; do
  case $s in
    setup) cap "$A" sf-setup-a & cap "$B" sf-setup-b; wait ;;
    share) echo shareFolder > "$A/menu.json.pick"; cap "$A" sf-share; cp "$A/menu.json" "$REPO/apps/videos/.capture/sf-share/menu.json"
      grep "share sheet" "$A/activation.log" | tail -1 > "$REPO/apps/videos/.capture/sf-share/share-sheet.txt" || true ;;
    add) echo addShared > "$B/menu.json.pick"; printf '%s\n' "$SHARED/Thesis Reading" > "$B/file-chooser.txt"; cap "$B" sf-add
      cp "$B/menu.json" "$REPO/apps/videos/.capture/sf-add/menu.json" ;;
    drop) pair "$B" sf-watch-drop "$A" sf-drop ;;
    back) pair "$A" sf-watch-back "$B" sf-back ;;
    rename) pair "$B" sf-watch-rename "$A" sf-rename ;;
    reorder) pair "$A" sf-watch-reorder "$B" sf-reorder ;;
    sub) pair "$B" sf-watch-sub "$A" sf-sub; ls "$SHARED/Thesis Reading" "$SHARED/Thesis Reading/Methods" > "$REPO/apps/videos/.capture/sf-sub/files.txt" ;;
  esac
done
ls -la "$SHARED/Thesis Reading" || true
