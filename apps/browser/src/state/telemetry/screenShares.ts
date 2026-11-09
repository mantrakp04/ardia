import type { PageState } from "../tabs/pageState";
import { capture, isSharing, useTelemetry } from "./client";

const ANSWER_MATCH_MS = 15_000;

export type ScreenShareVia = "sheet" | "tab" | "system_picker";

type Answer = { via: "sheet" | "tab"; at: number };
type Running = { via: ScreenShareVia; startedAt: number };

let answers = new Map<string, Answer>();
let running = new Map<string, Running>();

useTelemetry.subscribe((s, prev) => {
  if (prev.sharing && !s.sharing) {
    answers = new Map();
    running = new Map();
  }
});

export function noteDisplayAnswer(tabId: string, via: Answer["via"], now = Date.now()) {
  if (!isSharing()) return;
  answers.set(tabId, { via, at: now });
}

export function noteScreenAccess(tabId: string, on: boolean, now = Date.now()) {
  if (!isSharing()) return;
  const share = running.get(tabId);
  if (on && !share) {
    const answer = answers.get(tabId);
    answers.delete(tabId);
    const via: ScreenShareVia = answer && now - answer.at < ANSWER_MATCH_MS ? answer.via : "system_picker";
    running.set(tabId, { via, startedAt: now });
    capture("screen_share_started", { via });
  } else if (!on && share) {
    running.delete(tabId);
    emitEnded(share, now);
  }
}

function emitEnded(share: Running, now: number) {
  capture("screen_share_ended", { via: share.via, seconds: Math.max(0, Math.round((now - share.startedAt) / 1000)) });
}

export function endRunningScreenShares(now = Date.now()) {
  const shares = [...running.values()];
  running = new Map();
  for (const share of shares) emitEnded(share, now);
}

type SharePages = Record<string, Pick<PageState, "mediaAccess"> | undefined>;

export function screenSharePages(pages: SharePages, previous: SharePages, now = Date.now()) {
  if (pages === previous) return;
  for (const id in pages) if (pages[id]?.mediaAccess?.screen && !previous[id]?.mediaAccess?.screen) noteScreenAccess(id, true, now);
  for (const id in previous) if (previous[id]?.mediaAccess?.screen && !pages[id]?.mediaAccess?.screen) noteScreenAccess(id, false, now);
}
