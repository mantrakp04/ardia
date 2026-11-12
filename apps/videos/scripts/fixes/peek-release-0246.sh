#!/bin/bash
set -euo pipefail
S=${FIXES_SCRATCH:-$HOME/ardia-scratch/film-0246}
scene=$1
step=${2:-1}
mkdir -p "$S/peek"
for side in before after; do
  ffmpeg -v error -y -i "$S/footage/$side/$scene.mov" -vf "fps=1/$step,scale=680:-1,tile=4x3" -frames:v 1 "$S/peek/$scene-$side.jpg"
done
echo "$S/peek/$scene-before.jpg $S/peek/$scene-after.jpg"
