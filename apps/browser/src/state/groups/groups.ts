import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { newId } from "../browser/model";
import { closingGroup } from "../pins/organize";
import { withSplitRows } from "../splits/splits";
import { withNewTab } from "../tabs/tabs";
import type { BrowserWindow, ClosedGroupInfo, GroupColor, Tab, TabGroup } from "../browser/types";
import { depthOf, innermostGroupOf, nestGroups, reparent } from "./groupNesting";

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
  const pinnedGroup = new Set(Object.values(groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  const rank = (id: string) => (tabs[id]?.pinned ? (tabs[id]!.pinnedAsRow ? 1 : 0) : pinnedGroup.has(id) ? 1 : 2);
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
  return { ...s, windows: { ...s.windows, [windowId]: window }, groups: syncGroupOrder(groups, window) };
}

export function settleNesting(s: Pick<BrowserState, "groups" | "windows" | "tabs">): Pick<BrowserState, "groups" | "windows"> | null {
  if (!Object.values(s.groups).some((g) => g.parentId)) return null;
  let groups = nestGroups(s.groups);
  let windows = s.windows;
  for (const windowId of new Set(Object.values(groups).filter((g) => g.parentId).map((g) => g.windowId))) {
    const w = windows[windowId];
    if (!w) continue;
    const tabIds = orderSections(placeGroups(w.tabIds, groups, windowId), s.tabs, groups);
    const window = tabIds.every((id, i) => id === w.tabIds[i]) ? w : { ...w, tabIds };
    if (window !== w) windows = { ...windows, [windowId]: window };
    groups = syncGroupOrder(groups, window);
  }
  return groups === s.groups && windows === s.windows ? null : { groups, windows };
}

export const createGroupsSlice: StateCreator<BrowserState, [], [], GroupsSlice> = (set, get) => ({
  groups: {},

  createGroup(tabIds, options = {}) {
    const s = get();
    const tabs = withSplitRows(s, tabIds).map((id) => s.tabs[id]).filter((t) => t && !t.pinned);
    const first = tabs[0];
    if (!first || tabs.some((t) => t!.windowId !== first.windowId || t!.profileId !== first.profileId)) return "";
    const w = s.windows[first.windowId]!;
    const members = new Set(tabs.map((t) => t!.id));
    const window = { ...w, tabIds: placeBlock(w.tabIds, w.tabIds.filter((id) => members.has(id))) };
    const group: TabGroup = {
      id: newId("g"),
      windowId: w.id,
      profileId: first.profileId,
      name: options.name ?? "",
      icon: options.icon ?? null,
      color: options.color ?? null,
      collapsed: false,
      pinned: false,
      tabIds: window.tabIds.filter((id) => members.has(id)),
      createdAt: Date.now(),
    };
    set({ groups: { ...leaveGroups(s.groups, members), [group.id]: group }, windows: { ...s.windows, [w.id]: window } });
    return group.id;
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
        return t && !t.pinned && t.windowId === group.windowId && t.profileId === group.profileId && !group.tabIds.includes(id);
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
});
