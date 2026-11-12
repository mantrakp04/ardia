import type { PageEngine } from "../engines/engines";

export type PictureInPictureCloser = "app" | "chrome";

type CloseCounts = { auto: number; manual: number };

let nothingPlaying = 0;
const backToTab: Record<PageEngine, number> = { chromium: 0, webkit: 0 };
const closed: Record<PictureInPictureCloser, CloseCounts> = { app: { auto: 0, manual: 0 }, chrome: { auto: 0, manual: 0 } };

export function noteAutoPictureInPictureNothingPlaying() {
  nothingPlaying++;
}

export function notePictureInPictureBackToTab(engine: PageEngine) {
  backToTab[engine]++;
}

export function notePictureInPictureClosed(closedBy: PictureInPictureCloser, auto: boolean) {
  closed[closedBy][auto ? "auto" : "manual"]++;
}

export function takePictureInPictureCounts() {
  const taken = {
    nothingPlaying,
    backToTab: { ...backToTab },
    closed: { app: { ...closed.app }, chrome: { ...closed.chrome } },
  };
  nothingPlaying = 0;
  backToTab.chromium = 0;
  backToTab.webkit = 0;
  for (const by of Object.values(closed)) {
    by.auto = 0;
    by.manual = 0;
  }
  return taken;
}
