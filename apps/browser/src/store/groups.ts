import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { newId } from "./model";
import { closingGroup } from "./organize";
import { withSplitRows } from "./splits";
import { withNewTab } from "./tabs";
import type { BrowserWindow, GroupColor, Tab, TabGroup } from "./types";

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

export function reparent(next: Record<string, TabGroup>, was: Record<string, TabGroup>): Record<string, TabGroup> {
  for (const g of Object.values(next)) {
    if (!g.parentId || next[g.parentId]) continue;
    let up = was[g.parentId]?.parentId;
    while (up && !next[up]) up = was[up]?.parentId;
    next[g.id] = withParent(g, up);
  }
  return next;
}

export const withParent = (g: TabGroup, parentId: string | undefined): TabGroup => {
  if (g.parentId === parentId) return g;
  const { parentId: _, ...rest } = g;
  return parentId ? { ...rest, parentId } : rest;
};

function ancestorSet(groups: Record<string, TabGroup>, id: string): Set<string> {
  const seen = new Set<string>();
  for (let g = groups[id]; g?.parentId && groups[g.parentId] && !seen.has(g.parentId); g = groups[g.parentId]) seen.add(g.parentId);
  return seen;
}

export const depthOf = (groups: Record<string, TabGroup>, id: string): number => ancestorSet(groups, id).size;

export const ancestorIds = (groups: Record<string, TabGroup>, id: string): string[] => [...ancestorSet(groups, id)];

export function rootOf(groups: Record<string, TabGroup>, id: string): TabGroup | undefined {
  return groups[ancestorIds(groups, id).at(-1) ?? id];
}

export function descendantIds(groups: Record<string, TabGroup>, id: string): string[] {
  const children = new Map<string, string[]>();
  for (const g of Object.values(groups)) if (g.parentId) children.get(g.parentId)?.push(g.id) ?? children.set(g.parentId, [g.id]);
  const seen = new Set<string>([id]);
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}

export function commonGroup(groups: Record<string, TabGroup>, ids: string[]): TabGroup | undefined {
  let best: TabGroup | undefined;
  let bestDepth = -1;
  for (const g of Object.values(groups)) {
    if (!ids.every((id) => g.tabIds.includes(id))) continue;
    const depth = g.parentId ? depthOf(groups, g.id) : 0;
    if (depth <= bestDepth) continue;
    best = g;
    bestDepth = depth;
  }
  return best;
}

export const innermostGroupOf = (groups: Record<string, TabGroup>, tabId: string): TabGroup | undefined => commonGroup(groups, [tabId]);

export function groupPath(groups: Record<string, TabGroup>, id: string): string[] {
  return [...ancestorIds(groups, id).reverse(), id];
}

export function canNest(groups: Record<string, TabGroup>, groupId: string, parentId: string): boolean {
  const g = groups[groupId];
  const p = groups[parentId];
  if (!g || !p || groupId === parentId || g.windowId !== p.windowId || g.profileId !== p.profileId) return false;
  return !ancestorIds(groups, parentId).includes(groupId);
}

function lineage(groups: Record<string, TabGroup>) {
  const above = new Map<string, Set<string>>();
  const of = (id: string): Set<string> => {
    const known = above.get(id);
    if (known) return known;
    const chain: string[] = [];
    let at: string | undefined = id;
    while (at && groups[at] && !above.has(at) && !chain.includes(at)) {
      chain.push(at);
      at = groups[at]!.parentId;
    }
    let up = at && above.has(at) ? new Set([at, ...above.get(at)!]) : new Set<string>();
    for (const g of chain.reverse()) {
      above.set(g, up);
      up = new Set([g, ...up]);
    }
    return above.get(id)!;
  };
  return of;
}

const nested = new WeakMap<Record<string, TabGroup>, Record<string, TabGroup>>();

export function nestGroups(groups: Record<string, TabGroup>): Record<string, TabGroup> {
  const known = nested.get(groups);
  if (known) return known;
  const settled = nestOnce(groups);
  nested.set(groups, settled);
  return settled;
}

function nestOnce(groups: Record<string, TabGroup>): Record<string, TabGroup> {
  const all = Object.values(groups);
  if (!all.some((g) => g.parentId)) return groups;
  let next: Record<string, TabGroup> | null = null;
  const edit = (g: TabGroup) => ((next ??= { ...groups })[g.id] = g);
  const cur = (id: string) => (next ?? groups)[id]!;
  const ancestorsBefore = lineage(groups);
  for (const g of all) {
    if (!g.parentId) continue;
    const p = groups[g.parentId];
    const broken = !p || p.windowId !== g.windowId || p.profileId !== g.profileId || ancestorsBefore(g.parentId).has(g.id);
    if (broken) edit(withParent(cur(g.id), undefined));
  }
  const ancestors = lineage(next ?? groups);
  const byDepth = Object.values(next ?? groups)
    .filter((g) => g.parentId)
    .map((g) => [g.id, ancestors(g.id).size] as const)
    .sort((a, z) => z[1] - a[1]);
  for (const [id] of byDepth) {
    const g = cur(id);
    const p = cur(g.parentId!);
    const has = new Set(p.tabIds);
    const missing = g.tabIds.filter((t) => !has.has(t));
    if (missing.length) edit({ ...p, tabIds: [...p.tabIds, ...missing] });
  }
  for (const [id] of byDepth.slice().reverse()) {
    const g = cur(id);
    const pinned = cur(g.parentId!).pinned;
    if (g.pinned !== pinned) edit({ ...g, pinned });
  }
  const holders = new Map<string, string[]>();
  for (const g of Object.values(next ?? groups)) for (const t of g.tabIds) holders.get(t)?.push(g.id) ?? holders.set(t, [g.id]);
  const leaving = new Map<string, Set<string>>();
  for (const [t, ids] of holders) {
    if (ids.length < 2) continue;
    const deepest = ids.reduce((a, z) => (ancestors(z).size > ancestors(a).size ? z : a));
    const chain = ancestors(deepest);
    for (const id of ids) if (id !== deepest && !chain.has(id)) leaving.get(id)?.add(t) ?? leaving.set(id, new Set([t]));
  }
  for (const [id, gone] of leaving) edit({ ...cur(id), tabIds: cur(id).tabIds.filter((x) => !gone.has(x)) });
  const settled = next ?? groups;
  const emptied = Object.values(settled).filter((g) => !g.tabIds.length && groups[g.id]?.tabIds.length);
  if (!emptied.length) return settled;
  const kept = { ...settled };
  for (const g of emptied) delete kept[g.id];
  return reparent(kept, settled);
}

type GroupInfo = Pick<TabGroup, "id" | "name" | "icon" | "color">;

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
    next[id] = { id, name, icon, color, windowId, profileId, collapsed: false, pinned: false, tabIds, createdAt: Date.now(), ...(parentId ? { parentId } : {}) };
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
