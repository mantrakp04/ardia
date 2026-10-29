import type { MenuItem } from "../../platform/menus";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, isPinnedRow, tabLayoutOf } from "../browser/model";
import { live } from "../live/store";
import { updateProfile } from "../profiles/actions";
import { keptEntry } from "./entries";
import { pinnedSequence } from "./pinnedOrder";
import { entryKey } from "./entryKey";

export const PINNED_FOLD_TITLES = { collapse: "Collapse Pinned Tabs", expand: "Expand Pinned Tabs" } as const;

export const pinnedCollapsed = (s: Pick<BrowserState, "profiles">, profileId: string): boolean => !!s.profiles[profileId]?.pinnedCollapsed;

export function setPinnedCollapsed(profileId: string, collapsed: boolean) {
  const s = useBrowser.getState();
  if (!s.profiles[profileId] || pinnedCollapsed(s, profileId) === collapsed) return;
  updateProfile(profileId, { pinnedCollapsed: collapsed });
}

export const togglePinnedFold = (profileId: string) => setPinnedCollapsed(profileId, !pinnedCollapsed(useBrowser.getState(), profileId));

export function pinnedKept(s: BrowserState, windowId: string, profileId: string, entries: string[]): string | null {
  const kept = keptEntry(s, windowId, profileId, entries);
  if (kept) return kept;
  const folderId = s.tabs[activeTabId(s, windowId, profileId) ?? ""]?.liveItem?.folderId;
  const entry = folderId && entryKey("live", folderId);
  return entry && entries.includes(entry) ? entry : null;
}

export const shownPinnedEntries = (s: BrowserState, windowId: string, profileId: string, pinned: string[]): string[] =>
  pinnedCollapsed(s, profileId) ? [pinnedKept(s, windowId, profileId, pinned) ?? []].flat() : pinned;

function pinnedSectionTabs(s: Pick<BrowserState, "tabs" | "groups">, profileId: string): Set<string> {
  const ids = new Set<string>();
  for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) for (const id of g.tabIds) ids.add(id);
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId && isPinnedRow(t)) ids.add(t.id);
  return ids;
}

export function enteredPinnedSection(s: Pick<BrowserState, "tabs" | "groups">, prev: Pick<BrowserState, "tabs" | "groups">, profileId: string): boolean {
  const before = pinnedSectionTabs(prev, profileId);
  for (const id of pinnedSectionTabs(s, profileId)) if (prev.tabs[id] && !before.has(id)) return true;
  return false;
}

export function expandOnPin(s: BrowserState, prev: BrowserState) {
  if (s.tabs === prev.tabs && s.groups === prev.groups) return;
  for (const id of s.profileOrder) if (pinnedCollapsed(s, id) && enteredPinnedSection(s, prev, id)) setPinnedCollapsed(id, false);
}

useBrowser.subscribe(expandOnPin);

export function pinnedFoldMenuItem(s: BrowserState, windowId: string): MenuItem[] {
  const w = s.windows[windowId];
  if (!w || !s.profiles[w.profileId] || tabLayoutOf(s, w.id) !== "sidebar") return [];
  const collapsed = pinnedCollapsed(s, w.profileId);
  const hasPinned = pinnedSequence(s, live().folders, live().folderOrder, windowId, w.profileId).length > 0;
  return [
    collapsed
      ? { id: "pinnedFold", title: PINNED_FOLD_TITLES.expand, symbol: "rectangle.expand.vertical", enabled: hasPinned }
      : { id: "pinnedFold", title: PINNED_FOLD_TITLES.collapse, symbol: "rectangle.compress.vertical", enabled: hasPinned },
  ];
}

export function runPinnedFold(windowId: string, choice: string): boolean {
  if (choice !== "pinnedFold") return false;
  const profileId = useBrowser.getState().windows[windowId]?.profileId;
  if (profileId) togglePinnedFold(profileId);
  return true;
}
