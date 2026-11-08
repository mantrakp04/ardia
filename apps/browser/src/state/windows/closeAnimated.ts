import { animateWindowClose, focusWindow } from "../../platform/windows";
import { useBrowser, type BrowserState } from "../browser/store";
import { familyKeyOf } from "../browser/model";
import { isWindowClosing, startClosingWindow, stopClosingWindow } from "./closingWindows";

export { isWindowClosing };

const pending = new Map<string, () => void>();

const familiesIn = (s: BrowserState, tabIds: readonly string[]) => tabIds.flatMap((id) => (s.tabs[id] ? [familyKeyOf(s.tabs[id])] : []));

export function closeWindowAnimated(windowId: string, replacedBy: string | null = null, then?: () => void) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (isWindowClosing(windowId) || !w) return;
  const leaving = new Set(familiesIn(s, w.tabIds));
  const close = () => {
    if (!pending.delete(windowId)) return;
    stopClosingWindow(windowId);
    const after = useBrowser.getState();
    const now = after.windows[windowId];
    if (!now) return;
    if (familiesIn(after, now.tabIds).some((key) => !leaving.has(key))) return void focusWindow(windowId);
    useBrowser.getState().closeWindow(windowId);
    then?.();
  };
  startClosingWindow(windowId);
  pending.set(windowId, close);
  void animateWindowClose(windowId, replacedBy).then(close, close);
}

export function finishAnimatedCloses() {
  for (const close of [...pending.values()]) close();
}
