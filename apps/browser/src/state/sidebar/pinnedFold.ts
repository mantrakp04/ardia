import type { MenuItem } from "../../platform/menus";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, isPinnedRow, tabLayoutOf } from "../browser/model";
import { live } from "../live/store";
import { updateSpace } from "../spaces/actions";
import { keptEntry } from "./entries";
import { pinnedSequence } from "./pinnedOrder";
import { entryKey } from "./entryKey";

export const PINNED_FOLD_TITLES = { collapse: "Collapse Pinned Tabs", expand: "Expand Pinned Tabs" } as const;

export const pinnedCollapsed = (s: Pick<BrowserState, "spaces">, spaceId: string): boolean => !!s.spaces[spaceId]?.pinnedCollapsed;

export function setPinnedCollapsed(spaceId: string, collapsed: boolean) {
  const s = useBrowser.getState();
  if (!s.spaces[spaceId] || pinnedCollapsed(s, spaceId) === collapsed) return;
  updateSpace(spaceId, { pinnedCollapsed: collapsed });
}

export const togglePinnedFold = (spaceId: string) => setPinnedCollapsed(spaceId, !pinnedCollapsed(useBrowser.getState(), spaceId));

export function pinnedKept(s: BrowserState, windowId: string, spaceId: string, entries: string[]): string | null {
  const kept = keptEntry(s, windowId, spaceId, entries);
  if (kept) return kept;
  const folderId = s.tabs[activeTabId(s, windowId, spaceId) ?? ""]?.liveItem?.folderId;
  const entry = folderId && entryKey("live", folderId);
  return entry && entries.includes(entry) ? entry : null;
}

export const shownPinnedEntries = (s: BrowserState, windowId: string, spaceId: string, pinned: string[]): string[] =>
  pinnedCollapsed(s, spaceId) ? [pinnedKept(s, windowId, spaceId, pinned) ?? []].flat() : pinned;

function pinnedSectionTabs(s: Pick<BrowserState, "tabs" | "groups">, spaceId: string): Set<string> {
  const ids = new Set<string>();
  for (const g of Object.values(s.groups)) if (g.pinned && g.spaceId === spaceId) for (const id of g.tabIds) ids.add(id);
  for (const t of Object.values(s.tabs)) if (t.spaceId === spaceId && isPinnedRow(t)) ids.add(t.id);
  return ids;
}

export function enteredPinnedSection(s: Pick<BrowserState, "tabs" | "groups">, prev: Pick<BrowserState, "tabs" | "groups">, spaceId: string): boolean {
  const before = pinnedSectionTabs(prev, spaceId);
  for (const id of pinnedSectionTabs(s, spaceId)) if (prev.tabs[id] && !before.has(id)) return true;
  return false;
}

export function expandOnPin(s: BrowserState, prev: BrowserState) {
  if (s.tabs === prev.tabs && s.groups === prev.groups) return;
  for (const id of s.spaceOrder) if (pinnedCollapsed(s, id) && enteredPinnedSection(s, prev, id)) setPinnedCollapsed(id, false);
}

useBrowser.subscribe(expandOnPin);

export function pinnedFoldMenuItem(s: BrowserState, windowId: string): MenuItem[] {
  const w = s.windows[windowId];
  if (!w || !s.spaces[w.spaceId] || tabLayoutOf(s, w.id) !== "sidebar") return [];
  const collapsed = pinnedCollapsed(s, w.spaceId);
  const hasPinned = pinnedSequence(s, live().folders, live().folderOrder, windowId, w.spaceId).length > 0;
  return [
    collapsed
      ? { id: "pinnedFold", title: PINNED_FOLD_TITLES.expand, symbol: "rectangle.expand.vertical", enabled: hasPinned }
      : { id: "pinnedFold", title: PINNED_FOLD_TITLES.collapse, symbol: "rectangle.compress.vertical", enabled: hasPinned },
  ];
}

export function runPinnedFold(windowId: string, choice: string): boolean {
  if (choice !== "pinnedFold") return false;
  const spaceId = useBrowser.getState().windows[windowId]?.spaceId;
  if (spaceId) togglePinnedFold(spaceId);
  return true;
}
