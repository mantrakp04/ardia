import { capture, isSharing, useTelemetry } from "./client";
import { percentile } from "./transport";

export type TabPressEnd = "click" | "dragClick" | "drag";

const MAX_SAMPLES = 500;
const PAGE_CLICK_WINDOW_MS = 60_000;

const empty = () => ({ presses: 0, clicks: 0, drag_clicks: 0, drags: 0, unanswered: 0 });
let tally = empty();
let pending = false;
let shown: { tabId: string; at: number } | null = null;
let toPageClick: number[] = [];

function forgetPresses() {
  tally = empty();
  pending = false;
  shown = null;
  toPageClick = [];
}

useTelemetry.subscribe((s, prev) => prev.sharing && !s.sharing && forgetPresses());

export function notePressStarted() {
  if (!isSharing()) return;
  if (pending) tally.unanswered++;
  pending = true;
  tally.presses++;
}

export function notePressEnded(end: TabPressEnd, tabId: string | null = null) {
  if (!pending) return;
  pending = false;
  if (end === "click") tally.clicks++;
  else if (end === "dragClick") tally.drag_clicks++;
  else tally.drags++;
  shown = tabId ? { tabId, at: Date.now() } : null;
}

export function notePagePress(tabId: string) {
  const last = shown;
  shown = null;
  if (!last || last.tabId !== tabId || !isSharing()) return;
  const ms = Date.now() - last.at;
  if (ms >= 0 && ms < PAGE_CLICK_WINDOW_MS && toPageClick.length < MAX_SAMPLES) toPageClick.push(ms);
}

export function emitTabPresses() {
  const counts = tally;
  const samples = toPageClick.sort((a, b) => a - b);
  tally = empty();
  toPageClick = [];
  if (!isSharing() || !counts.presses) return;
  const at = (p: number) => (samples.length ? percentile(samples, p) : null);
  capture("tab_presses", { ...counts, page_click_ms_p50: at(0.5), page_click_ms_p75: at(0.75), page_click_n: samples.length });
}

export const devTabPresses = () => ({ ...tally, pending, toPageClick: toPageClick.length });
