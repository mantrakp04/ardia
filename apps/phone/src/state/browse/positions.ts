import { pageScrollPosition, savePageState } from "../pages/store";
import { currentTabs, saveTabState } from "../tabs/store";
import { findTab } from "../tabs/tabsState";
import { scrollSaveDecision, type ScrollWatch } from "../../lib/scrollSettle";

const SCROLL_CHECK_MS = 2000;
const RESTORE_LOG_DELAYS_MS = [600, 2500, 6000];

const watches = new Map<string, ScrollWatch>();
let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

const short = (id: string) => id.slice(0, 8);

export async function logPosition(event: string, id: string) {
  const at = await pageScrollPosition(id);
  if (!at) return console.log(`ardia-restore ${event} tab=${short(id)} no-position`);
  console.log(
    `ardia-restore ${event} tab=${short(id)} y=${Math.round(at.y)} viewport=${Math.round(at.viewportWidth ?? 0)}x${Math.round(at.viewportHeight)} content=${Math.round(at.contentHeight)}`,
  );
}

export function logRestore(id: string) {
  for (const delay of RESTORE_LOG_DELAYS_MS) setTimeout(() => void logPosition(`restored+${delay}ms`, id), delay);
}

export async function saveTabPosition(id: string, reason: string) {
  const at = await pageScrollPosition(id);
  const saved = await savePageState(id);
  if (!saved || !findTab(currentTabs(), id)) return;
  saveTabState(id, saved);
  if (at) watches.set(id, { lastSeen: at.y, lastSaved: at.y });
  console.log(
    `ardia-restore saved(${reason}) tab=${short(id)} y=${at ? Math.round(at.y) : "?"} viewport=${at ? `${Math.round(at.viewportWidth ?? 0)}x${Math.round(at.viewportHeight)}` : "?"}`,
  );
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
    if (step.save) await saveTabPosition(id, "scroll");
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
