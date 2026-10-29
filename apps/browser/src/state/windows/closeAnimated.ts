import { animateWindowClose, focusWindow } from "../../platform/windows";
import { managesWindowClose } from "../../platform/windowClose";
import { useBrowser, type BrowserState } from "../browser/store";
import type { CloseWindowOptions } from "./windows";
import { familyKeyOf } from "../browser/model";
import { isWindowClosing, startClosingWindow, stopClosingWindow } from "./closingWindows";
import { tabsHandedOver } from "../tabs/sharedWindowClose";
import { isOpenRegularWindow } from "./small";
import { noteWindowCloseTabsKept } from "../telemetry/usage";

export { isWindowClosing };

const pending = new Map<string, () => void>();

function familyCounts(s: BrowserState, tabIds: readonly string[]) {
  const counts = new Map<string, number>();
  for (const id of tabIds) {
    const t = s.tabs[id];
    if (t) counts.set(familyKeyOf(t), (counts.get(familyKeyOf(t)) ?? 0) + 1);
  }
  return counts;
}

type AnimatedCloseOptions = CloseWindowOptions & { replacedBy?: string | null; then?: () => void };

export function closeWindowAnimated(windowId: string, { replacedBy = null, then, ...options }: AnimatedCloseOptions = {}) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (isWindowClosing(windowId) || !w) return;
  if (!replacedBy && !then && managesWindowClose(windowId, "window")) return;
  const leaving = familyCounts(s, w.tabIds);
  const close = () => {
    if (!pending.delete(windowId)) return;
    stopClosingWindow(windowId);
    const after = useBrowser.getState();
    const now = after.windows[windowId];
    if (!now) return;
    if ([...familyCounts(after, now.tabIds)].some(([key, n]) => n > (leaving.get(key) ?? 0))) return void focusWindow(windowId);
    const kept = tabsHandedOver(after, windowId, isOpenRegularWindow).length;
    if (kept) noteWindowCloseTabsKept(kept);
    useBrowser.getState().closeWindow(windowId, options);
    then?.();
  };
  startClosingWindow(windowId);
  pending.set(windowId, close);
  void animateWindowClose(windowId, replacedBy).then(close, close);
}

export function finishAnimatedCloses() {
  for (const close of [...pending.values()]) close();
}
