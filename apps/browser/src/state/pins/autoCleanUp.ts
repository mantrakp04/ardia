import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { changedIds } from "../browser/changes";
import { nextCleanUpAt, noteDeselectedTabs } from "./tabCleanup";

const RECHECK_MS = 30 * 60 * 1000;
const RETRY_FLOOR_MS = 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

const inactiveForMs = (s: BrowserState) => {
  const minutes = s.settings.cleanUpInactiveTabsAfterMinutes;
  return minutes === null ? null : minutes * 60_000;
};

export function nextAutoCleanUpAt(s: BrowserState, now = Date.now()): number | null {
  const after = inactiveForMs(s);
  if (after === null) return null;
  let next = now + Math.min(after, RECHECK_MS);
  for (const id of s.windowOrder) next = Math.min(next, nextCleanUpAt(s, id, after));
  return next;
}

function schedule(floor = 0) {
  if (timer) clearTimeout(timer);
  timer = null;
  const now = Date.now();
  const at = nextAutoCleanUpAt(useBrowser.getState(), now);
  if (at !== null) timer = setTimeout(cleanUpDue, Math.max(floor, at - now));
}

function cleanUpDue() {
  timer = null;
  const s = useBrowser.getState();
  const after = inactiveForMs(s);
  if (after !== null) for (const id of s.windowOrder) useBrowser.getState().cleanUpTabs(id, { inactiveForMs: after });
  schedule(RETRY_FLOOR_MS);
}

function deselectedTabs(s: BrowserState, prev: BrowserState): string[] {
  const left: string[] = [];
  for (const id of changedIds(s.windows, prev.windows)) {
    const was = activeTabId(prev, id);
    if (was && was !== activeTabId(s, id)) left.push(was);
  }
  return left;
}

export function startAutoCleanUp() {
  if (unsubscribe) return;
  unsubscribe = useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows) {
      const left = deselectedTabs(s, prev);
      if (left.length) noteDeselectedTabs(s, left);
    }
    if (inactiveForMs(s) !== inactiveForMs(prev)) schedule();
  });
  schedule();
}

export function stopAutoCleanUp() {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
