import type { CaptureResult } from "../../platform/tabs";

const NONE = { started: 0, elements: 0, areas: 0, cancelled: 0, failed: 0, saved: 0 };
let counts = { ...NONE };

export const noteCaptureStarted = () => void counts.started++;

export const noteCaptureSaved = () => void counts.saved++;

export function noteCaptureEnded({ outcome, kind }: CaptureResult) {
  if (outcome === "copied") counts[kind === "area" ? "areas" : "elements"]++;
  else counts[outcome]++;
}

export function takeCaptureCounts() {
  const taken = counts;
  counts = { ...NONE };
  return taken;
}
