import { useBrowser, type BrowserState } from "../browser/store";
import { hideKeyedToast, showToast, useToasts } from "../app/toasts";

export type Undoable = { message?: string; undo: () => void; watched: (s: BrowserState) => unknown[]; canUndo: (s: BrowserState) => boolean };

let undoToasts = 0;

export function showUndoToast(windowId: string, title: string, icon: string, { message, undo, watched, canUndo }: Undoable) {
  const key = `undo-${++undoToasts}`;
  showToast(windowId, title, message, { icon, key, action: { title: "Undo", run: undo } });
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
