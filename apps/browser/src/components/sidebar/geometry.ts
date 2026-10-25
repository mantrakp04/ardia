import { layout } from "../../lib/theme";
import type { BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { groupEntries, sidebarEntries } from "./entries";

export const GROUP_PAD = 2;
export const GROUP_INDENT = 16;
export const GROUP_BORDER = 0.5;
export const GROUP_RADIUS = 12;
export const GROUP_HEADER_RADIUS = GROUP_RADIUS - GROUP_BORDER;
const ROW = layout.rowHeight;
const GAP = layout.rowGap;

export type Section = "pinnedGroups" | "list";

export function keptEntry(s: BrowserState, windowId: string, profileId: string, entries: string[]): string | null {
  const active = activeTabId(s, windowId, profileId);
  if (!active) return null;
  return entries.find((e) => holdsTab(s, e, active)) ?? null;
}

export function holdsTab(s: BrowserState, entry: string, tabId: string): boolean {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return !!s.groups[id]?.tabIds.includes(tabId);
  if (entry.startsWith("s:")) return !!s.splits[id]?.tabIds.includes(tabId);
  return id === tabId;
}

function membersHeight(s: BrowserState, windowId: string, profileId: string, groupId: string): number {
  const entries = groupEntries(s, groupId);
  if (!s.groups[groupId]?.collapsed) return entries.length ? entriesHeight(s, windowId, profileId, entries) + GROUP_PAD : GROUP_PAD;
  const kept = keptEntry(s, windowId, profileId, entries);
  return kept ? entryHeight(s, windowId, profileId, kept) + GROUP_PAD : 0;
}

export function entryHeight(s: BrowserState, windowId: string, profileId: string, entry: string): number {
  if (!entry.startsWith("g:")) return ROW;
  return GROUP_BORDER * 2 + ROW + membersHeight(s, windowId, profileId, entry.slice(2));
}

export function entriesHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  return entries.reduce((sum, e) => sum + entryHeight(s, windowId, profileId, e) + GAP, 0) - (entries.length ? GAP : 0);
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
  const within = (entries: string[], top: number): number | null => {
    for (const entry of entries) {
      if (holdsTab(s, entry, tabId)) {
        if (!entry.startsWith("g:")) return top;
        const id = entry.slice(2);
        const members = groupEntries(s, id);
        const header = top + GROUP_BORDER;
        if (!s.groups[id]!.collapsed) return within(members, header + ROW);
        const kept = keptEntry(s, windowId, profileId, members);
        return kept && holdsTab(s, kept, tabId) ? within([kept], header + ROW) : header;
      }
      top += entryHeight(s, windowId, profileId, entry) + GAP;
    }
    return null;
  };
  for (const [section, entries, start] of sections) {
    const top = within(entries, start);
    if (top !== null) return { section, top, height: ROW };
  }
  return null;
}
