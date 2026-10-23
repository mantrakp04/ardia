import { layout } from "../../lib/theme";
import type { BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { groupEntries, sidebarEntries } from "./entries";

export const GROUP_PAD = 2;
export const GROUP_MEMBER_INSET = 8;
export const GROUP_BORDER = 0.5;
export const GROUP_RADIUS = 12;
export const GROUP_HEADER_RADIUS = GROUP_RADIUS - GROUP_BORDER;
const ROW = layout.rowHeight;
const GAP = layout.rowGap;

export type Section = "pinnedGroups" | "list";

export function keptEntry(s: BrowserState, windowId: string, profileId: string, entries: string[]): string | null {
  const active = activeTabId(s, windowId, profileId);
  if (!active) return null;
  return entries.find((e) => e === `t:${active}` || (e.startsWith("s:") && !!s.splits[e.slice(2)]?.tabIds.includes(active))) ?? null;
}

function membersHeight(s: BrowserState, windowId: string, profileId: string, groupId: string): number {
  const entries = groupEntries(s, groupId);
  if (!s.groups[groupId]?.collapsed) return entries.length ? entries.length * ROW + (entries.length - 1) * GAP + GROUP_PAD : GROUP_PAD;
  return keptEntry(s, windowId, profileId, entries) ? ROW + GROUP_PAD : 0;
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
  const { pinnedRows, pinnedGroups, list } = sidebarEntries(s, windowId, profileId);
  const sections: [Section, string[], number][] = [
    ["pinnedGroups", [...pinnedRows.map((id) => `t:${id}`), ...pinnedGroups.map((id) => `g:${id}`)], 0],
    ["list", list, newTabAtTop ? ROW + GAP : 0],
  ];
  for (const [section, entries, start] of sections) {
    let top = start;
    for (const entry of entries) {
      const id = entry.slice(2);
      if (entry === `t:${tabId}` || (entry.startsWith("s:") && s.splits[id]?.tabIds.includes(tabId))) return { section, top, height: ROW };
      if (entry.startsWith("g:") && s.groups[id]?.tabIds.includes(tabId)) {
        const members = groupEntries(s, id);
        const at = members.findIndex((e) => e === `t:${tabId}` || (e.startsWith("s:") && !!s.splits[e.slice(2)]?.tabIds.includes(tabId)));
        const header = top + GROUP_BORDER;
        if (s.groups[id]!.collapsed) {
          const kept = keptEntry(s, windowId, profileId, members) === members[at];
          return kept ? { section, top: header + ROW, height: ROW } : { section, top: header, height: ROW };
        }
        return { section, top: header + ROW + at * (ROW + GAP), height: ROW };
      }
      top += entryHeight(s, windowId, profileId, entry) + GAP;
    }
  }
  return null;
}
