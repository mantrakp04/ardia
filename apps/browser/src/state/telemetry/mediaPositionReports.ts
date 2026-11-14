import type { NowPlaying } from "../../platform/media";

const REWIND_SECONDS = 1;
const PAST_END_SECONDS = 2;

type PositionReport = Pick<NowPlaying, "playbackState" | "position" | "duration" | "playbackRate" | "timestamp">;

let rewinds = 0;
let pastEnd = 0;

export function noteMediaPositionReport(before: PositionReport | undefined, report: PositionReport) {
  if (before?.playbackState !== "playing") return;
  const extrapolated = before.position + ((report.timestamp - before.timestamp) / 1000) * (before.playbackRate || 1);
  if (report.position < extrapolated - REWIND_SECONDS) rewinds++;
  if (before.duration && extrapolated > before.duration + PAST_END_SECONDS) pastEnd++;
}

export function takeMediaPositionCounts() {
  const taken = { media_position_rewinds: rewinds, media_reports_past_end: pastEnd };
  rewinds = 0;
  pastEnd = 0;
  return taken;
}
