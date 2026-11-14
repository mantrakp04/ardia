import { pageScrollPosition, savePageState } from "../pages/store";
import { currentTabs, saveTabState } from "../tabs/store";
import { findTab } from "../tabs/tabsState";
import { scrollSaveDecision, type ScrollWatch } from "../../lib/scrollSettle";

const SCROLL_CHECK_MS = 2000;

const watches = new Map<string, ScrollWatch>();
let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

export async function saveTabPosition(id: string) {
  const at = await pageScrollPosition(id);
  const saved = await savePageState(id);
  if (!saved || !findTab(currentTabs(), id)) return;
  saveTabState(id, saved);
  if (at) watches.set(id, { lastSeen: at.y, lastSaved: at.y });
}

async function checkFront(frontId: () => string | null) {
  const id = frontId();
  if (!id || checking) return;
  checking = true;
  try {
    const at = await pageScrollPosition(id);
    if (!at || frontId() !== id) return;
    const step = scrollSaveDecision(watches.get(id) ?? { lastSeen: null, lastSaved: null }, at.y);
    watches.set(id, step.next);
    if (step.save) await saveTabPosition(id);
  } finally {
    checking = false;
  }
}

export function watchFrontScroll(frontId: () => string | null) {
  if (timer) return;
  timer = setInterval(() => void checkFront(frontId), SCROLL_CHECK_MS);
}

export function forgetPosition(id: string) {
  watches.delete(id);
}
