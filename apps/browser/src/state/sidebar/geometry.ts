import { sidebarMetrics, type SidebarMetrics } from "../../lib/sidebarMetrics";
import { useBrowser, type BrowserState } from "../browser/store";
import { live } from "../live/store";
import { ancestorIds } from "../groups/groups";
import { groupOf } from "../pins/tabGrouping";
import { splitOf } from "../splits/splits";
import { groupEntries, holdsTab, keptEntries, sidebarEntries } from "./entries";
import { shownPinnedEntries } from "./pinnedFold";
import { entryId, entryKey } from "./entryKey";
import { pinSection } from "../browser/model";

export type Section = "pinnedGroups" | "list";

export const metricsOf = (s: Pick<BrowserState, "settings">): SidebarMetrics => sidebarMetrics(s.settings.sidebarScale);

export const headGap = (first: string | null | undefined, gap: number): number => (first && entryId(first, "group") !== null ? gap : 0);

function stackHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  const m = metricsOf(s);
  return entries.length ? headGap(entries[0], m.rowGap) + entriesHeight(s, windowId, profileId, entries) + m.group.membersPadBottom : 0;
}

function membersHeight(s: BrowserState, windowId: string, profileId: string, groupId: string): number {
  const collapsed = !!s.groups[groupId]?.collapsed;
  return stackHeight(s, windowId, profileId, collapsed ? keptEntries(s, windowId, profileId, groupId) : groupEntries(s, groupId));
}

export function entryHeight(s: BrowserState, windowId: string, profileId: string, entry: string): number {
  const m = metricsOf(s);
  const groupId = entryId(entry, "group");
  if (groupId === null) return m.rowHeight;
  return m.group.border * 2 + m.rowHeight + membersHeight(s, windowId, profileId, groupId);
}

export function entriesHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  const gap = metricsOf(s).rowGap;
  return entries.reduce((sum, e) => sum + entryHeight(s, windowId, profileId, e) + gap, 0) - (entries.length ? gap : 0);
}

export function entriesWithin(s: BrowserState, windowId: string, profileId: string, entries: string[], height: number): number {
  const gap = metricsOf(s).rowGap;
  let top = 0;
  let n = 0;
  while (n < entries.length && top < height) top += entryHeight(s, windowId, profileId, entries[n++]!) + gap;
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
  const { rowHeight, rowGap, group } = metricsOf(s);
  const { pinned, list } = sidebarEntries(s, windowId, profileId);
  const sections: [Section, string[], number][] = [
    ["pinnedGroups", shownPinnedEntries(s, windowId, profileId, pinned), 0],
    ["list", list, newTabAtTop ? rowHeight + rowGap : 0],
  ];
  const within = (entries: string[], top: number): number | null => {
    for (const entry of entries) {
      if (holdsTab(s, entry, tabId)) {
        const id = entryId(entry, "group");
        if (id === null) return top;
        const members = groupEntries(s, id);
        const header = top + group.border;
        if (!s.groups[id]!.collapsed) return within(members, header + rowHeight + headGap(members[0], rowGap));
        const kept = keptEntries(s, windowId, profileId, id);
        return within(kept, header + rowHeight + headGap(kept[0], rowGap)) ?? header;
      }
      top += entryHeight(s, windowId, profileId, entry) + rowGap;
    }
    return null;
  };
  for (const [section, entries, start] of sections) {
    const top = within(entries, start);
    if (top !== null) return { section, top, height: rowHeight };
  }
  return null;
}

export const entryHeightNow = (windowId: string, profileId: string, entry: string): number => entryHeight(useBrowser.getState(), windowId, profileId, entry);

export const firstPaintEntriesNow = (windowId: string, profileId: string, entries: string[], lazy: boolean): number =>
  firstPaintEntries(useBrowser.getState(), windowId, profileId, entries, lazy);

export function foldedGroupHeight(windowId: string, profileId: string, groupId: string): number {
  const s = useBrowser.getState();
  const m = metricsOf(s);
  return m.group.border * 2 + m.rowHeight + stackHeight(s, windowId, profileId, keptEntries(s, windowId, profileId, groupId));
}

export const usePendingEntriesHeight = (windowId: string, profileId: string, entries: string[], from: number, growing: boolean): number =>
  useBrowser((s) => (growing ? entriesHeight(s, windowId, profileId, entries.slice(from)) : 0));

export type RevealSpot = { span: { section: Section; top: number; height: number } } | { keys: string[] } | null;

export function revealSpot(windowId: string, tabId: string, tilesFixed: boolean, newTabAtTop: boolean): RevealSpot {
  const s = useBrowser.getState();
  const profileId = s.windows[windowId]?.profileId;
  if (!profileId) return null;
  const pinned = s.tabs[tabId];
  if (tilesFixed && pinSection(pinned) === "tile") return null;
  const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
  const pinnedHasLive = span?.section === "pinnedGroups" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
  if (span && !pinnedHasLive) return { span };
  const split = splitOf(s, tabId);
  const inner = groupOf(s, tabId);
  return { keys: [tabId, ...(split ? [entryKey("split", split.id)] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])] };
}
