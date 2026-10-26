import { useBrowser, type BrowserState } from "./browser";
import { activeTabId } from "./model";

let reopenedTabIds: string[] = [];
let closedStacksAfterUndo: string | null = null;

const closedStacks = (s: BrowserState) =>
  [s.closedTabs, s.closedWindows, s.closedGroups].map((list) => `${list.length}:${list.at(-1)?.id ?? ""}`).join(",");

function reopenedTabId(before: BrowserState, after: BrowserState): string | undefined {
  const added = Object.keys(after.tabs).filter((id) => !before.tabs[id]);
  if (added.length) return added.length === 1 ? added[0] : undefined;
  const left = new Set(after.closedTabs.map((c) => c.id));
  const entry = before.closedTabs.find((c) => !left.has(c.id));
  if (!entry?.pinnedTile || !entry.tabId || !after.tabs[entry.tabId]) return undefined;
  return after.windows[entry.windowId] ? activeTabId(after, entry.windowId) : entry.tabId;
}

export function canRedoCloseTab(s: BrowserState): boolean {
  const id = reopenedTabIds.at(-1);
  return !!id && !!s.tabs[id] && closedStacks(s) === closedStacksAfterUndo;
}

export function undoCloseTab(windowId?: string | null) {
  const before = useBrowser.getState();
  if (closedStacks(before) !== closedStacksAfterUndo) reopenedTabIds = [];
  before.reopenClosed(windowId);
  const after = useBrowser.getState();
  if (after === before) return;
  const reopened = reopenedTabId(before, after);
  reopenedTabIds = reopened ? [...reopenedTabIds, reopened] : [];
  closedStacksAfterUndo = closedStacks(after);
}

export async function redoCloseTab(close: (tabId: string) => unknown = (id) => useBrowser.getState().closeTab(id)) {
  if (!canRedoCloseTab(useBrowser.getState())) return;
  const tabId = reopenedTabIds.pop()!;
  const before = closedStacks(useBrowser.getState());
  await close(tabId);
  const after = useBrowser.getState();
  if (closedStacks(after) === before && after.tabs[tabId]) reopenedTabIds.push(tabId);
  else closedStacksAfterUndo = closedStacks(after);
}
