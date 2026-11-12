import type { TabGroup } from "../browser/types";

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
