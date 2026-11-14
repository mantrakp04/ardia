import { capture, ensureInstallId, setSharing } from "./client";
import { NO_WATCH, save, savedChoice } from "./choice";

export const WATCH_DAYS = 14;
const DAY_MS = 86_400_000;
const CHECK_EVERY_MS = 60 * 60_000;

const monotonicNow = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

let lastMonotonic: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export type WatchStatus = { report: string; until: number; turnedSharingOn: boolean } | null;

export function watchStatus(): WatchStatus {
  const s = savedChoice();
  if (!s.watchReport || s.watchUntil === null) return null;
  return { report: s.watchReport, until: s.watchUntil, turnedSharingOn: s.sharingUntil !== null };
}

export function startWatch(reportId: string, days = WATCH_DAYS, now = Date.now()) {
  const span = Math.max(1, Math.min(WATCH_DAYS, days)) * DAY_MS;
  const until = now + span;
  const current = savedChoice();
  const wasSharing = current.sharing && current.sharingUntil === null;
  if (!current.sharing) {
    ensureInstallId();
    setSharing(true, "watch");
  }
  save({
    watchReport: reportId,
    watchStartedAt: now,
    watchUntil: until,
    sharingUntil: wasSharing ? null : until,
    watchCountedMs: 0,
    watchCheckedAt: now,
    watchEndedNotice: null,
  });
  lastMonotonic = monotonicNow();
  capture("watch_started", { days: Math.round(span / DAY_MS), turned_sharing_on: !wasSharing });
  schedule(now);
}

function endWatch(reason: "expired" | "clock" | "stopped") {
  const s = savedChoice();
  const report = s.watchReport;
  if (!report) return;
  capture("watch_ended", { reason, turned_sharing_on: s.sharingUntil !== null });
  if (s.sharingUntil !== null) {
    setSharing(false, "watch_ended");
    if (reason !== "stopped") save({ watchEndedNotice: report });
  } else save({ ...NO_WATCH });
  clearTimeout(timer);
  timer = undefined;
}

export const stopWatch = () => endWatch("stopped");

export function checkWatch(now = Date.now(), sameSession = lastMonotonic !== null) {
  const s = savedChoice();
  if (!s.watchReport || s.watchStartedAt === null || s.watchUntil === null) return;
  const span = s.watchUntil - s.watchStartedAt;
  const mono = monotonicNow();
  const wallDelta = s.watchCheckedAt === null ? 0 : now - s.watchCheckedAt;
  const monoDelta = sameSession && lastMonotonic !== null ? Math.max(0, mono - lastMonotonic) : 0;
  lastMonotonic = mono;
  if (wallDelta < 0 && !sameSession) return endWatch("clock");
  if (now < s.watchStartedAt) return endWatch("clock");
  const counted = s.watchCountedMs + Math.max(wallDelta, monoDelta);
  if (now >= s.watchUntil || counted >= span) return endWatch("expired");
  save({ watchCountedMs: counted, watchCheckedAt: now });
  schedule(now);
}

function schedule(now: number) {
  clearTimeout(timer);
  const s = savedChoice();
  if (!s.watchReport || s.watchUntil === null || s.watchStartedAt === null) return;
  const left = Math.min(s.watchUntil - now, s.watchUntil - s.watchStartedAt - s.watchCountedMs);
  timer = setTimeout(() => checkWatch(), Math.max(1_000, Math.min(CHECK_EVERY_MS, left)));
}

export function startWatchChecks() {
  lastMonotonic = null;
  checkWatch(Date.now(), false);
}

export const pendingWatchNotice = () => savedChoice().watchEndedNotice;

export const watchNoticeShown = () => save({ watchEndedNotice: null });
