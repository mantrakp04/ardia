import type { BrowserState } from "../browser/store";
import type { Tab, TabGroup } from "../browser/types";
import { activeTabId, IDLE_LIVE, makeTab, newId } from "../browser/model";
import { nestGroups, orderSections, syncGroupOrder } from "../groups/groups";
import { markPinned } from "../pins/pinChoices";
import { removeTabs } from "../tabs/tabs";
import { ASLEEP, hasPage } from "../tabs/pageSession";
import type { LocalFolder } from "./local";
import type { TargetEntry, TargetLevel } from "./tree";

export const APPLIED_FIELDS = ["tabs", "live", "groups", "windows", "windowOrder", "windowUi", "find", "splits", "selection", "closedTabs", "pinChoices"] as const;

function keysIn(level: TargetLevel, links: Set<string>, dirs: Set<string>) {
  for (const e of level.entries) {
    if (e.key) (e.kind === "link" ? links : dirs).add(e.key);
    if (e.kind === "dir") keysIn(e.level, links, dirs);
  }
}

const hasLink = (level: TargetLevel): boolean => level.entries.some((e) => e.kind === "link" || hasLink(e.level));

export const EMPTY_FOLDER_URL = "about:blank";
const EMPTY_FOLDER_TITLE = "Empty Folder";

const isPlaceholder = (t: Tab | undefined) => !!t && !hasPage(t) && (!t.url || t.url === EMPTY_FOLDER_URL);

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function withFolder(s: BrowserState, groupId: string, level: TargetLevel, folder: LocalFolder): BrowserState {
  const root = s.groups[groupId];
  const w = root && s.windows[root.windowId];
  if (!root || !w) return s;
  const { windowId, profileId } = root;
  const links = new Set<string>();
  const dirs = new Set<string>();
  keysIn(level, links, dirs);
  const shown = activeTabId(s, windowId);
  const goneLinks = [...folder.tabOf].filter(([key]) => !links.has(key)).map(([, id]) => id);
  const blanks = hasLink(level) ? (folder.others.get(groupId) ?? []).filter((id) => isPlaceholder(s.tabs[id]) && id !== shown) : [];
  const released = goneLinks.filter((id) => hasPage(s.tabs[id]!) || id === shown);
  const removed = [...goneLinks.filter((id) => !released.includes(id)), ...blanks];
  let dirty = goneLinks.length + blanks.length > 0;

  const next = removed.length ? removeTabs(s, removed, false) : s;
  const tabs: Record<string, Tab> = { ...next.tabs };
  const live = { ...next.live };
  let groups: Record<string, TabGroup> = { ...next.groups };
  for (const id of released) tabs[id] = { ...tabs[id]!, pinnedUrl: null, pinKey: undefined };
  for (const [key, id] of folder.groupOf) if (!dirs.has(key) && groups[id]) (delete groups[id], (dirty = true));
  const created: string[] = [];

  const placeLink = (e: Extract<TargetEntry, { kind: "link" }>): string => {
    const id = e.key ? folder.tabOf.get(e.key) : undefined;
    const t = id ? tabs[id] : undefined;
    if (t && e.key) {
      const patch: Partial<Tab> = {};
      if (e.name !== folder.nameOf.get(e.key)) patch.customTitle = e.name;
      if (e.url !== folder.urlOf.get(e.key)) Object.assign(patch, { pinnedUrl: e.url }, hasPage(t) ? {} : { url: e.url });
      if (Object.keys(patch).length) (tabs[t.id] = { ...t, ...patch }, (dirty = true));
      return t.id;
    }
    const tab: Tab = { ...makeTab(windowId, profileId, e.url, { title: e.name, customTitle: e.name }), pinnedUrl: e.url, page: ASLEEP };
    tabs[tab.id] = tab;
    live[tab.id] = IDLE_LIVE;
    created.push(tab.id);
    e.key = tab.id;
    dirty = true;
    return tab.id;
  };

  const place = (at: TargetLevel, parentId: string): string[] => {
    const out: string[] = [];
    for (const e of at.entries) {
      if (e.kind === "link") {
        out.push(placeLink(e));
        continue;
      }
      const known = e.key ? folder.groupOf.get(e.key) : undefined;
      const existing = known ? (groups[known] ?? s.groups[known]) : undefined;
      const id = existing?.id ?? newId("g");
      const inner = [...place(e.level, id), ...(existing ? (folder.others.get(id) ?? []).filter((x) => tabs[x] && !removed.includes(x)) : [])];
      if (!inner.length) {
        if (existing) (delete groups[id], (dirty = true));
        e.key = null;
        continue;
      }
      if (!existing) {
        groups[id] = { id, windowId, profileId, name: e.name, icon: null, color: null, collapsed: true, pinned: true, tabIds: inner, createdAt: Date.now(), parentId };
        e.key = id;
        dirty = true;
      } else {
        const renamed = e.name !== folder.nameOf.get(e.key!);
        if (renamed) dirty = true;
        groups[id] = { ...existing, ...(renamed ? { name: e.name } : {}), tabIds: inner };
      }
      out.push(...inner);
    }
    return out;
  };

  const placed = place(level, groupId);
  const inPlace = new Set(placed);
  const leftover = root.tabIds.filter((id) => tabs[id] && !inPlace.has(id) && !released.includes(id) && !removed.includes(id));
  let members = [...placed, ...leftover];
  if (!members.length) {
    const blank: Tab = { ...makeTab(windowId, profileId, EMPTY_FOLDER_URL, { title: EMPTY_FOLDER_TITLE, customTitle: EMPTY_FOLDER_TITLE }), page: ASLEEP };
    tabs[blank.id] = blank;
    live[blank.id] = IDLE_LIVE;
    members = [blank.id];
    dirty = true;
  }
  groups[groupId] = { ...(groups[groupId] ?? root), tabIds: members };

  const window = next.windows[windowId]!;
  const block = new Set(members);
  const old = new Set(root.tabIds);
  const first = window.tabIds.findIndex((id) => old.has(id) || block.has(id));
  const rest = window.tabIds.filter((id) => !block.has(id) && !(old.has(id) && !released.includes(id)));
  const at = first < 0 ? rest.length : window.tabIds.slice(0, first).filter((id) => rest.includes(id)).length;
  const ids = [...rest];
  ids.splice(at, 0, ...members);
  groups = nestGroups(groups);
  const arranged = { ...window, tabIds: orderSections(ids, tabs, groups) };
  groups = syncGroupOrder(groups, arranged);
  const unchanged =
    !dirty && sameIds(arranged.tabIds, window.tabIds) && Object.values(groups).every((g) => g.windowId !== windowId || sameIds(g.tabIds, s.groups[g.id]?.tabIds ?? []));
  if (unchanged) return s;
  const pinChoices = created.length ? markPinned(next.pinChoices, profileId, { placed: created }) : next.pinChoices;
  return { ...next, tabs, live, groups, windows: { ...next.windows, [windowId]: arranged }, pinChoices };
}
