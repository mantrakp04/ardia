import type { PageEngine } from "../engines/engines";

let nothingPlaying = 0;
const backToTab: Record<PageEngine, number> = { chromium: 0, webkit: 0 };
const drags = { total: 0, held: 0, slipped: 0 };

export function noteAutoPictureInPictureNothingPlaying() {
  nothingPlaying++;
}

export function notePictureInPictureBackToTab(engine: PageEngine) {
  backToTab[engine]++;
}

export function notePictureInPictureDragged({ held, slipped }: { held: boolean; slipped: boolean }) {
  drags.total++;
  if (held) drags.held++;
  if (slipped) drags.slipped++;
}

export function takePictureInPictureCounts() {
  const taken = { nothingPlaying, backToTab: { ...backToTab }, drags: { ...drags } };
  nothingPlaying = 0;
  drags.total = 0;
  drags.held = 0;
  drags.slipped = 0;
  backToTab.chromium = 0;
  backToTab.webkit = 0;
  return taken;
}
