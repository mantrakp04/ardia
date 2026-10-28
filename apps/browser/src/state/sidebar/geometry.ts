import { SIDEBAR_GROUP, SIDEBAR_ROW } from "../../lib/sidebarMetrics";
import { useBrowser, type BrowserState } from "../browser/store";
import { live } from "../live/store";
import { ancestorIds } from "../groups/groups";
import { groupOf } from "../pins/organize";
import { splitOf } from "../splits/splits";
import { groupEntries, holdsTab, keptEntries, sidebarEntries } from "./entries";

const GROUP_PAD = SIDEBAR_GROUP.pad;
const GROUP_BORDER = SIDEBAR_GROUP.border;
const ROW = SIDEBAR_ROW.height;
const GAP = SIDEBAR_ROW.gap;

export type Section = "pinnedGroups" | "list";

export const headGap = (first: string | null | undefined): number => (first?.startsWith("g:") ? GAP : 0);

function membersHeight(s: BrowserState, windowId: string, profileId: string, groupId: string, foldId?: string): number {
  const entries = groupEntries(s, groupId);
  if (foldId) return entriesHeight(s, windowId, profileId, keptEntries(s, windowId, profileId, foldId, entries), foldId);
  if (!s.groups[groupId]?.collapsed) return entries.length ? headGap(entries[0]) + entriesHeight(s, windowId, profileId, entries) + GROUP_PAD : GROUP_PAD;
  const kept = keptEntries(s, windowId, profileId, groupId, entries);
  return kept.length ? entriesHeight(s, windowId, profileId, kept, groupId) + GROUP_PAD : 0;
}

export function entryHeight(s: BrowserState, windowId: string, profileId: string, entry: string, foldId?: string): number {
  if (!entry.startsWith("g:")) return ROW;
  if (foldId) return membersHeight(s, windowId, profileId, entry.slice(2), foldId);
  return GROUP_BORDER * 2 + ROW + membersHeight(s, windowId, profileId, entry.slice(2));
}

export function entriesHeight(s: BrowserState, windowId: string, profileId: string, entries: string[], foldId?: string): number {
  return entries.reduce((sum, e) => sum + entryHeight(s, windowId, profileId, e, foldId) + GAP, 0) - (entries.length ? GAP : 0);
}

export function entriesWithin(s: BrowserState, windowId: string, profileId: string, entries: string[], height: number): number {
  let top = 0;
  let n = 0;
  while (n < entries.length && top < height) top += entryHeight(s, windowId, profileId, entries[n++]!) + GAP;
  return n;
}

const EAGER_FIRST_PAINT_ENTRIES = 64;
export const FIRST_PAINT_HEIGHT = 2400;

export function firstPaintEntries(s: BrowserState, windowId: string, profileId: string, entries: string[], lazy: boolean): number {
  if (!lazy) return EAGER_FIRST_PAINT_ENTRIES;
  return Math.max(1, entriesWithin(s, windowId, profileId, entries, s.windows[windowId]?.frame?.[3] ?? FIRST_PAINT_HEIGHT));
}

export const startsOffScreen = (lazy: boolean, current: boolean) => lazy && !current;

export function rowSpan(
  s: BrowserState,
  windowId: string,
  profileId: string,
  tabId: string,
  newTabAtTop: boolean,
): { section: Section; top: number; height: number } | null {
  const { pinned, list } = sidebarEntries(s, windowId, profileId);
  const sections: [Section, string[], number][] = [
    ["pinnedGroups", pinned, 0],
    ["list", list, newTabAtTop ? ROW + GAP : 0],
  ];
  const within = (entries: string[], top: number, foldId?: string, header?: number): number | null => {
    for (const entry of entries) {
      if (holdsTab(s, entry, tabId)) {
        if (!entry.startsWith("g:")) return top;
        const id = entry.slice(2);
        const members = groupEntries(s, id);
        if (foldId) return within(keptEntries(s, windowId, profileId, foldId, members), top, foldId, header) ?? header ?? null;
        const own = top + GROUP_BORDER;
        if (!s.groups[id]!.collapsed) return within(members, own + ROW + headGap(members[0]));
        return within(keptEntries(s, windowId, profileId, id, members), own + ROW, id, own) ?? own;
      }
      top += entryHeight(s, windowId, profileId, entry, foldId) + GAP;
    }
    return null;
  };
  for (const [section, entries, start] of sections) {
    const top = within(entries, start);
    if (top !== null) return { section, top, height: ROW };
  }
  return null;
}

export const entryHeightNow = (windowId: string, profileId: string, entry: string): number => entryHeight(useBrowser.getState(), windowId, profileId, entry);

export const firstPaintEntriesNow = (windowId: string, profileId: string, entries: string[], lazy: boolean): number =>
  firstPaintEntries(useBrowser.getState(), windowId, profileId, entries, lazy);

export function foldedGroupHeight(windowId: string, profileId: string, groupId: string): number {
  const s = useBrowser.getState();
  const kept = keptEntries(s, windowId, profileId, groupId, groupEntries(s, groupId));
  return GROUP_BORDER * 2 + ROW + (kept.length ? entriesHeight(s, windowId, profileId, kept, groupId) + GROUP_PAD : 0);
}

export const usePendingEntriesHeight = (windowId: string, profileId: string, entries: string[], from: number, growing: boolean): number =>
  useBrowser((s) => (growing ? entriesHeight(s, windowId, profileId, entries.slice(from)) : 0));

export type RevealSpot = { span: { section: Section; top: number; height: number } } | { keys: string[] } | null;

export function revealSpot(windowId: string, tabId: string, tilesFixed: boolean, newTabAtTop: boolean): RevealSpot {
  const s = useBrowser.getState();
  const profileId = s.windows[windowId]?.profileId;
  if (!profileId) return null;
  const pinned = s.tabs[tabId];
  if (tilesFixed && pinned?.pinned && !pinned.pinnedAsRow) return null;
  const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
  const pinnedHasLive = span?.section === "pinnedGroups" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
  if (span && !pinnedHasLive) return { span };
  const split = splitOf(s, tabId);
  const inner = groupOf(s, tabId);
  return { keys: [tabId, ...(split ? [`s:${split.id}`] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])] };
}
