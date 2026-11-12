import { capture, useTelemetry } from "./client";
import { percentile } from "./transport";

export type TabPressEnd = "click" | "dragClick" | "drag";

const MAX_SAMPLES = 500;
const PAGE_CLICK_WINDOW_MS = 60_000;

const empty = () => ({ presses: 0, down_switches: 0, clicks: 0, drag_clicks: 0, drags: 0, unanswered: 0 });
let tally = empty();
let pending = false;
let shown: { tabId: string; at: number } | null = null;
let toPageClick: number[] = [];
let heldMs: number[] = [];
let pressedAt: number | null = null;

function forgetPresses() {
  tally = empty();
  pending = false;
  shown = null;
  toPageClick = [];
  heldMs = [];
  pressedAt = null;
}

useTelemetry.subscribe((s, prev) => prev.sharing && !s.sharing && forgetPresses());

export function notePressStarted(switchedOnPress = false) {
  if (pending) tally.unanswered++;
  pending = true;
  tally.presses++;
  if (switchedOnPress) tally.down_switches++;
  pressedAt = switchedOnPress ? Date.now() : null;
}

export function notePressEnded(end: TabPressEnd, tabId: string | null = null) {
  if (!pending) return;
  pending = false;
  const held = pressedAt === null ? -1 : Date.now() - pressedAt;
  pressedAt = null;
  if (end !== "drag" && held >= 0 && held < PAGE_CLICK_WINDOW_MS && heldMs.length < MAX_SAMPLES) heldMs.push(held);
  if (end === "click") tally.clicks++;
  else if (end === "dragClick") tally.drag_clicks++;
  else tally.drags++;
  shown = tabId ? { tabId, at: Date.now() } : null;
}

export function notePagePress(tabId: string) {
  const last = shown;
  shown = null;
  if (!last || last.tabId !== tabId) return;
  const ms = Date.now() - last.at;
  if (ms >= 0 && ms < PAGE_CLICK_WINDOW_MS && toPageClick.length < MAX_SAMPLES) toPageClick.push(ms);
}

export function emitTabPresses() {
  const counts = tally;
  const samples = toPageClick.sort((a, b) => a - b);
  const held = heldMs.sort((a, b) => a - b);
  tally = empty();
  toPageClick = [];
  heldMs = [];
  if (!counts.presses) return;
  const at = (list: number[], p: number) => (list.length ? percentile(list, p) : null);
  capture("tab_presses", {
    ...counts,
    page_click_ms_p50: at(samples, 0.5),
    page_click_ms_p75: at(samples, 0.75),
    page_click_n: samples.length,
    held_ms_p50: at(held, 0.5),
    held_ms_p75: at(held, 0.75),
    held_n: held.length,
  });
}

export const devTabPresses = () => ({ ...tally, pending, toPageClick: toPageClick.length, held: heldMs.length });
