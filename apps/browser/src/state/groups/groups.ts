import type { GroupPlacement } from "../pins/tabGrouping";
import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { bookmarkProfileId, isPinnedRow, newId, snapshotTab, tabTitle } from "../browser/model";
import { closingGroup, nestedSnapshot, rebuildNested, restoreSnapshots } from "../pins/closedTabs";
import { groupLabel, movingGroup, withGroup, withRowsGrouped } from "../pins/tabGrouping";
import { withSplitRows } from "../splits/splits";
import { withNewTab } from "../tabs/tabs";
import type { BrowserWindow, ClosedGroup, ClosedGroupInfo, GroupColor, Tab, TabGroup } from "../browser/types";
import { depthOf, innermostGroupOf, nestGroups, reparent } from "./groupNesting";
import { pinnedGroupMembers } from "../browser/structure";
import { groupingOnto } from "../pins/placing";

export { ancestorIds, canNest, commonGroup, depthOf, descendantIds, groupPath, innermostGroupOf, nestGroups, reparent, rootOf, withParent } from "./groupNesting";

export type GroupsSlice = {
  groups: Record<string, TabGroup>;

  createGroup(tabIds: string[], options?: { name?: string; icon?: string | null; color?: GroupColor | null }): string;
  updateGroup(id: string, patch: Partial<Pick<TabGroup, "name" | "icon" | "color" | "collapsed" | "pinned">>): void;
  addTabsToGroup(groupId: string, tabIds: string[]): void;
  removeTabsFromGroup(tabIds: string[]): void;
  ungroup(groupId: string): void;
  newNestedGroup(parentId: string): string;
  closeGroup(groupId: string): void;
  deleteGroup(groupId: string): void;
  closedGroups: ClosedGroup[];
  deletedGroups: ClosedGroup[];
  groupTabs(ids: string[], options?: { pinned?: boolean; name?: string }): string;
  groupOnto(ids: string[], targetId: string): string;
  moveGroup(groupId: string, placement: GroupPlacement): void;
  duplicateGroup(groupId: string): string;
  newTabInGroup(groupId: string): string;
  moveGroupToBookmarksBar(groupId: string): void;
};

export function syncGroupOrder(groups: Record<string, TabGroup>, window: BrowserWindow): Record<string, TabGroup> {
  groups = nestGroups(groups);
  const at = new Map(window.tabIds.map((id, i) => [id, i]));
  let next: Record<string, TabGroup> | null = null;
  for (const g of Object.values(groups)) {
    if (g.windowId !== window.id) continue;
    if (g.tabIds.every((id, i) => at.has(id) && (i === 0 || at.get(id)! > at.get(g.tabIds[i - 1]!)!))) continue;
    const members = new Set(g.tabIds);
    (next ??= { ...groups })[g.id] = { ...g, tabIds: window.tabIds.filter((id) => members.has(id)) };
  }
  return next ?? groups;
}

export function orderSections(ids: string[], tabs: Record<string, Tab>, groups: Record<string, TabGroup>): string[] {
  const pinnedGroup = pinnedGroupMembers(groups);
  const rank = (id: string) => (tabs[id]?.pin ? (isPinnedRow(tabs[id]) ? 1 : 0) : pinnedGroup.has(id) ? 1 : 2);
  const out = [0, 1, 2].flatMap((r) => ids.filter((id) => rank(id) === r));
  return out.every((id, i) => id === ids[i]) ? ids : out;
}

export function insertAll(list: string[], at: number, items: string[]) {
  const tail = list.splice(at);
  for (const x of items) list.push(x);
  for (const x of tail) list.push(x);
}

export function placeBlock(tabIds: string[], block: string[]): string[] {
  const members = new Set(block);
  const at = tabIds.findIndex((id) => members.has(id));
  const rest = tabIds.filter((id) => !members.has(id));
  const before = tabIds.slice(0, at).filter((id) => !members.has(id)).length;
  insertAll(rest, before, block);
  return rest;
}

export function placeGroups(tabIds: string[], groups: Record<string, TabGroup>, windowId: string): string[] {
  const own = Object.values(groups)
    .filter((g) => g.windowId === windowId)
    .map((g) => [g, depthOf(groups, g.id)] as const)
    .sort((a, z) => a[1] - z[1]);
  let at = new Map(tabIds.map((id, i) => [id, i]));
  for (const [g] of own) {
    const spots = g.tabIds.flatMap((id) => at.get(id) ?? []);
    const [low, high] = spots.reduce(([a, z], i) => [Math.min(a, i), Math.max(z, i)], [Infinity, -Infinity]);
    if (!spots.length || high - low + 1 === spots.length) continue;
    const members = new Set(g.tabIds);
    tabIds = placeBlock(tabIds, tabIds.filter((id) => members.has(id)));
    at = new Map(tabIds.map((id, i) => [id, i]));
  }
  return tabIds;
}

export function leaveGroups(groups: Record<string, TabGroup>, ids: Set<string>, keep?: Set<string>): Record<string, TabGroup> {
  if (!Object.values(groups).some((g) => !keep?.has(g.id) && g.tabIds.some((id) => ids.has(id)))) return groups;
  const next: Record<string, TabGroup> = {};
  for (const g of Object.values(groups)) {
    const tabIds = keep?.has(g.id) ? g.tabIds : g.tabIds.filter((id) => !ids.has(id));
    if (tabIds.length === g.tabIds.length) next[g.id] = g;
    else if (tabIds.length > (g.autoUngroup && !g.pinnedOpenerId ? 1 : 0)) next[g.id] = { ...g, tabIds };
  }
  return reparent(next, groups);
}

type GroupInfo = ClosedGroupInfo;

export const closedGroupInfo = (g: TabGroup): GroupInfo => ({ id: g.id, name: g.name, icon: g.icon, color: g.color, ...(g.pinned ? { pinned: true } : {}) });

export function rejoinGroups(
  groups: Record<string, TabGroup>,
  chain: GroupInfo[],
  tabIds: string[],
  windowId: string,
  profileId: string,
  made: Map<string, string> = new Map(),
): Record<string, TabGroup> {
  const here = (info: GroupInfo) => {
    const g = groups[made.get(info.id) ?? info.id];
    return g && g.windowId === windowId && g.profileId === profileId ? g : undefined;
  };
  const at = chain.findIndex(here);
  const next = { ...groups };
  let parentId: string | undefined;
  if (at >= 0) {
    const g = here(chain[at]!)!;
    next[g.id] = { ...g, tabIds: [...g.tabIds, ...tabIds.filter((id) => !g.tabIds.includes(id))] };
    parentId = g.id;
  }
  for (const info of chain.slice(0, at < 0 ? chain.length : at).reverse()) {
    const id = next[info.id] ? newId("g") : info.id;
    const { id: _, name, icon, color } = info;
    next[id] = { id, name, icon, color, windowId, profileId, collapsed: false, pinned: !!info.pinned, tabIds, createdAt: Date.now(), ...(parentId ? { parentId } : {}) };
    made.set(info.id, id);
    parentId = id;
  }
  return nestGroups(next);
}

export function withGroupsPlaced<S extends Pick<BrowserState, "groups" | "windows" | "tabs">>(s: S, windowId: string, groups: Record<string, TabGroup>): S {
  const w = s.windows[windowId]!;
  const tabIds = orderSections(placeGroups(w.tabIds, groups, windowId), s.tabs, groups);
  const window = tabIds.every((id, i) => id === w.tabIds[i]) ? w : { ...w, tabIds };
  return { ...s, windows: window === w ? s.windows : { ...s.windows, [windowId]: window }, groups: syncGroupOrder(groups, window) };
}

export function settleNesting(s: Pick<BrowserState, "groups" | "windows" | "tabs">): Pick<BrowserState, "groups" | "windows"> | null {
  if (!Object.values(s.groups).some((g) => g.parentId)) return null;
  let next = { groups: nestGroups(s.groups), windows: s.windows, tabs: s.tabs };
  for (const windowId of new Set(Object.values(next.groups).filter((g) => g.parentId).map((g) => g.windowId))) {
    if (next.windows[windowId]) next = withGroupsPlaced(next, windowId, next.groups);
  }
  return next.groups === s.groups && next.windows === s.windows ? null : { groups: next.groups, windows: next.windows };
}

export const createGroupsSlice: StateCreator<BrowserState, [], [], GroupsSlice> = (set, get) => ({
  groups: {},
  closedGroups: [],
  deletedGroups: [],

  createGroup(tabIds, options = {}) {
    const [next, id] = withGroup(get(), tabIds, { name: options.name, parentId: null });
    if (!id) return "";
    set({ groups: { ...next.groups, [id]: { ...next.groups[id]!, icon: options.icon ?? null, color: options.color ?? null } }, windows: next.windows });
    return id;
  },

  updateGroup(id, patch) {
    set((s) => {
      const g = s.groups[id];
      if (!g) return {};
      const groups = { ...s.groups, [id]: { ...g, ...patch } };
      const w = s.windows[g.windowId];
      if (patch.pinned === undefined || patch.pinned === g.pinned || !w) return { groups };
      const window = { ...w, tabIds: orderSections(w.tabIds, s.tabs, groups) };
      return { groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } };
    });
  },

  addTabsToGroup(groupId, tabIds) {
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return {};
      const adding = withSplitRows(s, tabIds).filter((id) => {
        const t = s.tabs[id];
        return t && !t.pin && t.windowId === group.windowId && t.profileId === group.profileId && !group.tabIds.includes(id);
      });
      if (!adding.length) return {};
      const w = s.windows[group.windowId]!;
      const block = placeBlock(w.tabIds, [...group.tabIds, ...adding]);
      const groups = nestGroups({ ...leaveGroups(s.groups, new Set(adding)), [groupId]: { ...group, tabIds: [...group.tabIds, ...adding] } });
      const window = { ...w, tabIds: placeGroups(block, groups, w.id) };
      return { groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } };
    });
  },

  removeTabsFromGroup(tabIds) {
    set((s) => {
      let groups = s.groups;
      const windows = { ...s.windows };
      const touched = new Set<string>();
      for (const id of withSplitRows(s, tabIds)) {
        const g = innermostGroupOf(groups, id);
        const w = g && windows[g.windowId];
        if (!g || !w) continue;
        touched.add(w.id);
        const kept = g.tabIds.filter((x) => x !== id);
        if (kept.length) {
          const order = w.tabIds.filter((x) => x !== id);
          order.splice(order.indexOf(kept.at(-1)!) + 1, 0, id);
          windows[w.id] = { ...w, tabIds: order };
          groups = { ...groups, [g.id]: { ...g, tabIds: kept } };
        } else {
          const { [g.id]: _, ...rest } = groups;
          groups = reparent(rest, groups);
        }
      }
      let next = { tabs: s.tabs, windows, groups };
      for (const windowId of touched) next = withGroupsPlaced(next, windowId, next.groups);
      return { groups: next.groups, windows: next.windows };
    });
  },

  ungroup(groupId) {
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return {};
      const { [groupId]: _, ...rest } = s.groups;
      const groups = reparent(rest, s.groups);
      if (!s.windows[group.windowId]) return { groups };
      const next = withGroupsPlaced(s, group.windowId, groups);
      return { groups: next.groups, windows: next.windows };
    });
  },

  newNestedGroup(parentId) {
    const s = get();
    const p = s.groups[parentId];
    const w = p && s.windows[p.windowId];
    if (!p || !w) return "";
    const [next, tabId] = withNewTab(s, w.id, { profileId: p.profileId, index: w.tabIds.indexOf(p.tabIds.at(-1)!) + 1 });
    const group: TabGroup = {
      id: newId("g"),
      windowId: w.id,
      profileId: p.profileId,
      name: "",
      icon: null,
      color: null,
      collapsed: false,
      pinned: p.pinned,
      tabIds: [tabId],
      createdAt: Date.now(),
      parentId,
    };
    const groups = nestGroups({ ...next.groups, [parentId]: { ...p, collapsed: false }, [group.id]: group });
    set(withGroupsPlaced(next, w.id, groups));
    return group.id;
  },

  closeGroup(groupId) {
    set(closingGroup(get(), groupId));
  },

  deleteGroup(groupId) {
    set(closingGroup(get(), groupId, true));
  },

  groupTabs(ids, { pinned = true, name } = {}) {
    const [next, id] = withRowsGrouped(get(), ids, { pinned, name });
    if (id) set({ ...next, selection: { ...next.selection, [next.groups[id]!.windowId]: [] } });
    return id;
  },

  groupOnto(ids, targetId) {
    const [next, id] = groupingOnto(get(), ids, targetId);
    if (id) set(next);
    return id;
  },

  moveGroup(groupId, p) {
    set((s) => movingGroup(s, groupId, p));
  },

  duplicateGroup(groupId) {
    let s = get();
    const g = s.groups[groupId];
    const w = g && s.windows[g.windowId];
    if (!g || !w) return "";
    const after = w.tabIds.indexOf(g.tabIds.at(-1)!) + 1;
    const [restored, ids] = restoreSnapshots(
      s,
      w.id,
      g.tabIds.map((id, i) => ({ tab: { ...snapshotTab(s.tabs[id]!), pin: null }, index: after + i })),
    );
    let groupId2: string;
    [s, groupId2] = withGroup(restored, ids, { name: g.name, pinned: g.pinned, parentId: g.parentId ?? null });
    if (groupId2) {
      s = { ...s, groups: { ...s.groups, [groupId2]: { ...s.groups[groupId2]!, icon: g.icon, color: g.color } } };
      s = rebuildNested(s, groupId2, g.id, ids, nestedSnapshot(get(), g));
    }
    set(s);
    return groupId2;
  },

  newTabInGroup(groupId) {
    const s = get();
    const g = s.groups[groupId];
    const w = g && s.windows[g.windowId];
    if (!g || !w) return "";
    const [next, id] = withNewTab(s, w.id, { profileId: g.profileId, index: w.tabIds.indexOf(g.tabIds.at(-1)!) + 1 });
    const groups = nestGroups({ ...next.groups, [groupId]: { ...g, collapsed: false, tabIds: [...g.tabIds, id] } });
    set(withGroupsPlaced(next, w.id, groups));
    return id;
  },

  moveGroupToBookmarksBar(groupId) {
    const s = get();
    const g = s.groups[groupId];
    if (!g) return;
    const profileId = bookmarkProfileId(s, s.windows[g.windowId]);
    const file = (group: TabGroup, parentId?: string) => {
      const folder = get().addBookmarkFolder({ profileId, title: groupLabel(s, group), ...(parentId ? { parentId } : {}) });
      const children = Object.values(s.groups).filter((c) => c.parentId === group.id);
      const filed = new Set<string>();
      for (const id of group.tabIds) {
        const child = children.find((c) => c.tabIds.includes(id));
        if (child) {
          if (filed.has(child.id)) continue;
          filed.add(child.id);
          file(child, folder);
          continue;
        }
        const t = s.tabs[id];
        if (t?.url) get().addBookmark({ profileId, url: t.url, title: tabTitle(t), favicon: t.favicon, parentId: folder });
      }
    };
    file(g);
    set(closingGroup(get(), groupId));
  },
});
