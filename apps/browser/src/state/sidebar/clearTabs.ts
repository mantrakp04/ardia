import { closeTab } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { plural } from "../browser/model";
import { cleanedTabsFor } from "../pins/closedTabs";
import { canUndoClear, type ClearedTabs } from "../pins/tabCleanup";
import { hideKeyedToast, showToast, useToasts } from "../app/toasts";
import { noteCleanUp } from "../telemetry/usage";

const store = () => useBrowser.getState();

export function closeAllTabs(windowId: string) {
  const cleared = store().clearUnpinnedTabs(windowId);
  if (cleared?.entries.length) showClearUndo(cleared, `Cleared ${plural(cleared.entries.length, "Tab")}`, "arrow.down");
}

export function cleanUpWithUndo(windowId: string) {
  const before = new Set(cleanedTabsFor(store(), windowId).map((c) => c.id));
  if (!store().cleanUpTabs(windowId)) return;
  const cleanedIds = cleanedTabsFor(store(), windowId).map((c) => c.id).filter((id) => !before.has(id));
  showUndoToast(windowId, `Cleaned Up ${plural(cleanedIds.length, "Tab")}`, "wand.and.stars", {
    undo: () => {
      noteCleanUp("undone");
      store().restoreCleaned(cleanedIds, windowId);
    },
    watched: (s) => [s.cleanedTabs, s.privateCleanedTabs],
    canUndo: (s) => {
      const left = new Set(cleanedTabsFor(s, windowId).map((c) => c.id));
      return cleanedIds.every((id) => left.has(id));
    },
  });
}

export function middleClickTab(tabId: string) {
  const removed = store().removeClosedPin(tabId);
  if (!removed) return void closeTab(tabId);
  if (removed.entries.length) showClearUndo(removed, "Removed Pinned Tab", "pin.slash");
}

const showClearUndo = (cleared: ClearedTabs, title: string, icon: string) =>
  showUndoToast(cleared.windowId, title, icon, {
    undo: () => store().undoClearTabs(cleared),
    watched: (s) => [s.windows[cleared.windowId], s.tabs, s.groups, s.splits, s.closedTabs],
    canUndo: (s) => canUndoClear(s, cleared),
  });

type Undoable = { undo: () => void; watched: (s: BrowserState) => unknown[]; canUndo: (s: BrowserState) => boolean };

let undoToasts = 0;

function showUndoToast(windowId: string, title: string, icon: string, { undo, watched, canUndo }: Undoable) {
  const key = `undo-clear-${++undoToasts}`;
  showToast(windowId, title, undefined, { icon, key, action: { title: "Undo", run: undo } });
  let seen: unknown[] = [];
  const stop = () => {
    stopWatchingStore();
    stopWatchingToast();
  };
  const stopWatchingStore = useBrowser.subscribe((s) => {
    if (!s.windows[windowId]) {
      hideKeyedToast(windowId, key);
      return stop();
    }
    const now = watched(s);
    if (now.every((x, i) => x === seen[i])) return;
    seen = now;
    if (canUndo(s)) return;
    hideKeyedToast(windowId, key);
    stop();
  });
  const stopWatchingToast = useToasts.subscribe((t) => {
    if (t.toasts[windowId]?.key !== key) stop();
  });
}
