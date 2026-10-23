import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { newId } from "./model";
import { closingGroup } from "./organize";
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
  let changed = false;
  const next = { ...groups };
  for (const g of Object.values(groups)) {
    if (g.windowId !== window.id) continue;
    const members = new Set(g.tabIds);
    const tabIds = window.tabIds.filter((id) => members.has(id));
    if (tabIds.length !== g.tabIds.length || tabIds.some((id, i) => id !== g.tabIds[i])) {
      next[g.id] = { ...g, tabIds };
      changed = true;
    }
  }
  return changed ? next : groups;
}

export function orderSections(ids: string[], tabs: Record<string, Tab>, groups: Record<string, TabGroup>): string[] {
  const pinnedGroup = new Set(Object.values(groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  const rank = (id: string) => (tabs[id]?.pinned ? (tabs[id]!.pinnedAsRow ? 1 : 0) : pinnedGroup.has(id) ? 2 : 3);
  const out = [0, 1, 2, 3].flatMap((r) => ids.filter((id) => rank(id) === r));
  return out.every((id, i) => id === ids[i]) ? ids : out;
}

export function placeBlock(tabIds: string[], block: string[]): string[] {
  const members = new Set(block);
  const at = tabIds.findIndex((id) => members.has(id));
  const rest = tabIds.filter((id) => !members.has(id));
  const before = tabIds.slice(0, at).filter((id) => !members.has(id)).length;
  rest.splice(before, 0, ...block);
  return rest;
}

export function placeGroups(tabIds: string[], groups: Record<string, TabGroup>, windowId: string): string[] {
  const own = Object.values(groups)
    .filter((g) => g.windowId === windowId)
    .map((g) => [g, depthOf(groups, g.id)] as const)
    .sort((a, z) => a[1] - z[1]);
  for (const [g] of own) {
    const members = new Set(g.tabIds);
    tabIds = placeBlock(tabIds, tabIds.filter((id) => members.has(id)));
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

export function depthOf(groups: Record<string, TabGroup>, id: string): number {
  let depth = 0;
  for (let g = groups[id]; g?.parentId && groups[g.parentId] && depth < 64; g = groups[g.parentId]) depth++;
  return depth;
}

export function ancestorIds(groups: Record<string, TabGroup>, id: string): string[] {
  const out: string[] = [];
  for (let g = groups[id]; g?.parentId && groups[g.parentId] && !out.includes(g.parentId); g = groups[g.parentId]) out.push(g.parentId);
  return out;
}

export function rootOf(groups: Record<string, TabGroup>, id: string): TabGroup | undefined {
  return groups[ancestorIds(groups, id).at(-1) ?? id];
}

export const childGroups = (groups: Record<string, TabGroup>, id: string): TabGroup[] => Object.values(groups).filter((g) => g.parentId === id);

export function descendantIds(groups: Record<string, TabGroup>, id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const g of childGroups(groups, parent)) if (!out.includes(g.id) && g.id !== id) (out.push(g.id), walk(g.id));
  };
  walk(id);
  return out;
}

export function innermostGroupOf(groups: Record<string, TabGroup>, tabId: string): TabGroup | undefined {
  let best: TabGroup | undefined;
  let bestDepth = -1;
  for (const g of Object.values(groups)) {
    if (!g.tabIds.includes(tabId)) continue;
    const depth = g.parentId ? depthOf(groups, g.id) : 0;
    if (depth > bestDepth) (best = g), (bestDepth = depth);
  }
  return best;
}

export function commonGroup(groups: Record<string, TabGroup>, ids: string[]): TabGroup | undefined {
  let best: TabGroup | undefined;
  let bestDepth = -1;
  for (const g of Object.values(groups)) {
    if (!ids.every((id) => g.tabIds.includes(id))) continue;
    const depth = depthOf(groups, g.id);
    if (depth > bestDepth) (best = g), (bestDepth = depth);
  }
  return best;
}

export function directTabIds(groups: Record<string, TabGroup>, groupId: string): string[] {
  const g = groups[groupId];
  if (!g) return [];
  const nested = new Set(childGroups(groups, groupId).flatMap((c) => c.tabIds));
  return nested.size ? g.tabIds.filter((id) => !nested.has(id)) : g.tabIds;
}

export function groupPath(groups: Record<string, TabGroup>, id: string): string[] {
  return [...ancestorIds(groups, id).reverse(), id];
}

export function canNest(groups: Record<string, TabGroup>, groupId: string, parentId: string): boolean {
  const g = groups[groupId];
  const p = groups[parentId];
  if (!g || !p || groupId === parentId || g.windowId !== p.windowId || g.profileId !== p.profileId) return false;
  return !ancestorIds(groups, parentId).includes(groupId);
}

export function nestGroups(groups: Record<string, TabGroup>): Record<string, TabGroup> {
  const all = Object.values(groups);
  if (!all.some((g) => g.parentId)) return groups;
  let next: Record<string, TabGroup> | null = null;
  const edit = (g: TabGroup) => ((next ??= { ...groups })[g.id] = g);
  const cur = (id: string) => (next ?? groups)[id]!;
  for (const g of all) {
    if (!g.parentId) continue;
    const p = groups[g.parentId];
    const broken = !p || p.windowId !== g.windowId || p.profileId !== g.profileId || ancestorIds(groups, g.parentId).includes(g.id);
    if (broken) edit(withParent(cur(g.id), undefined));
  }
  const view = next ?? groups;
  const byDepth = Object.values(view)
    .filter((g) => g.parentId)
    .map((g) => [g.id, depthOf(view, g.id)] as const)
    .sort((a, z) => z[1] - a[1]);
  for (const [id] of byDepth) {
    const g = cur(id);
    const p = cur(g.parentId!);
    const missing = g.tabIds.filter((t) => !p.tabIds.includes(t));
    if (missing.length) edit({ ...p, tabIds: [...p.tabIds, ...missing] });
  }
  for (const [id] of byDepth.slice().reverse()) {
    const g = cur(id);
    const pinned = cur(g.parentId!).pinned;
    if (g.pinned !== pinned) edit({ ...g, pinned });
  }
  const holders = new Map<string, string[]>();
  for (const g of Object.values(next ?? groups)) for (const t of g.tabIds) holders.set(t, [...(holders.get(t) ?? []), g.id]);
  for (const [t, ids] of holders) {
    if (ids.length < 2) continue;
    const view = next ?? groups;
    const deepest = ids.reduce((a, z) => (depthOf(view, z) > depthOf(view, a) ? z : a));
    const chain = new Set([deepest, ...ancestorIds(view, deepest)]);
    for (const id of ids) if (!chain.has(id)) edit({ ...cur(id), tabIds: cur(id).tabIds.filter((x) => x !== t) });
  }
  return next ?? groups;
}

export type GroupInfo = Pick<TabGroup, "id" | "name" | "icon" | "color">;

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

export function settleNesting(s: Pick<BrowserState, "groups" | "windows">): Pick<BrowserState, "groups" | "windows"> | null {
  if (!Object.values(s.groups).some((g) => g.parentId)) return null;
  let groups = nestGroups(s.groups);
  let windows = s.windows;
  for (const windowId of new Set(Object.values(groups).filter((g) => g.parentId).map((g) => g.windowId))) {
    const w = windows[windowId];
    if (!w) continue;
    const tabIds = placeGroups(w.tabIds, groups, windowId);
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
    const tabs = tabIds.map((id) => s.tabs[id]).filter((t) => t && !t.pinned);
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
      const adding = tabIds.filter((id) => {
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
      for (const id of tabIds) {
        const g = innermostGroupOf(groups, id);
        const w = g && windows[g.windowId];
        if (!g || !w) continue;
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
      for (const w of Object.values(windows)) if (w !== s.windows[w.id]) groups = syncGroupOrder(groups, w);
      return { groups, windows };
    });
  },

  ungroup(groupId) {
    set((s) => {
      const { [groupId]: _, ...groups } = s.groups;
      return { groups: reparent(groups, s.groups) };
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
    const groups = { ...next.groups, [parentId]: { ...p, collapsed: false }, [group.id]: group };
    set({ ...next, groups: syncGroupOrder(groups, next.windows[w.id]!) });
    return group.id;
  },

  closeGroup(groupId) {
    set(closingGroup(get(), groupId));
  },

  deleteGroup(groupId) {
    set(closingGroup(get(), groupId, true));
  },
});
