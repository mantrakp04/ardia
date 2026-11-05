import { closeTab } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { plural } from "../browser/model";
import { canUndoClear, type ClearedTabs } from "../pins/tabCleanup";
import { hideKeyedToast, showToast, useToasts } from "../app/toasts";

const store = () => useBrowser.getState();

let undoToasts = 0;

function showUndoToast(cleared: ClearedTabs, title: string, icon: string) {
  const { windowId } = cleared;
  const key = `undo-clear-${++undoToasts}`;
  showToast(windowId, title, undefined, { icon, key, action: { title: "Undo", run: () => store().undoClearTabs(cleared) } });
  let seen: unknown[] = [];
  const stop = () => {
    stopWatchingStore();
    stopWatchingToast();
  };
  const stopWatchingStore = useBrowser.subscribe((s) => {
    const now = [s.windows[windowId], s.tabs, s.groups, s.splits, s.closedTabs];
    if (now.every((x, i) => x === seen[i])) return;
    seen = now;
    if (canUndoClear(s, cleared)) return;
    hideKeyedToast(windowId, key);
    stop();
  });
  const stopWatchingToast = useToasts.subscribe((t) => {
    if (t.toasts[windowId]?.key !== key) stop();
  });
}

export function closeAllTabs(windowId: string) {
  const cleared = store().clearUnpinnedTabs(windowId);
  if (cleared?.entries.length) showUndoToast(cleared, `Cleared ${plural(cleared.entries.length, "Tab")}`, "arrow.down");
}

export function middleClickTab(tabId: string) {
  const removed = store().removeClosedPin(tabId);
  if (!removed) return void closeTab(tabId);
  if (removed.entries.length) showUndoToast(removed, "Removed Pinned Tab", "pin.slash");
}
