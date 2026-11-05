import type { BrowserState } from "../browser/store";
import type { SplitView, TabGroup } from "../browser/types";
import { newId, pinKeyOf } from "../browser/model";
import { descendantIds, nestGroups, withGroupsPlaced, withParent } from "../groups/groups";
import { keyField } from "../pins/pinMirror";
import { splitTabIds } from "../splits/splits";

export function groupTree(groups: Record<string, TabGroup>, groupId: string): TabGroup[] {
  const root = groups[groupId];
  return root ? [withParent(root, undefined), ...descendantIds(groups, groupId).map((id) => groups[id]!)] : [];
}

function mirroredGroups(s: BrowserState, tree: TabGroup[], windowId: string, profileId: string): Map<string, TabGroup> {
  const found = new Map<string, TabGroup>();
  const here = Object.values(s.groups).filter((x) => x.windowId === windowId && x.profileId === profileId && !x.pinned);
  for (const g of tree) {
    const own = here.find((x) => x.id !== g.id && pinKeyOf(x) === pinKeyOf(g) && ![...found.values()].includes(x));
    if (own) found.set(g.id, own);
  }
  return found;
}

export function regrouped(s: BrowserState, tree: TabGroup[], windowId: string, profileId: string, fresh: boolean): BrowserState {
  const mirrors = fresh ? new Map<string, TabGroup>() : mirroredGroups(s, tree, windowId, profileId);
  const ids = new Map(tree.map((g) => [g.id, mirrors.get(g.id)?.id ?? (fresh || s.groups[g.id] ? newId("g") : g.id)]));
  const groups = { ...s.groups };
  for (const g of tree) {
    const incoming = g.tabIds.filter((id) => s.tabs[id]?.windowId === windowId && s.tabs[id]?.profileId === profileId);
    const own = mirrors.get(g.id);
    const keys = new Set(incoming.map((id) => pinKeyOf(s.tabs[id]!)));
    const stay = (own?.tabIds ?? []).filter((id) => !incoming.includes(id) && s.tabs[id]?.windowId === windowId && !keys.has(pinKeyOf(s.tabs[id]!)));
    const tabIds = [...incoming, ...stay];
    if (!tabIds.length) continue;
    const id = ids.get(g.id)!;
    const parentId = g.parentId ? ids.get(g.parentId) : undefined;
    const { pinKey: _, ...unkeyed } = g;
    const base = fresh ? unkeyed : own ? { ...g, ...keyField(own.id, pinKeyOf(own)) } : g;
    groups[id] = withParent({ ...base, id, windowId, profileId, tabIds }, parentId && groups[parentId] ? parentId : undefined);
  }
  const w = s.windows[windowId];
  if (!w) return s;
  const order = (tree[0]?.tabIds ?? []).filter((id) => w.tabIds.includes(id));
  const members = new Set(order);
  let next = 0;
  const tabIds = w.tabIds.map((id) => (members.has(id) ? order[next++]! : id));
  return withGroupsPlaced({ ...s, windows: { ...s.windows, [windowId]: { ...w, tabIds } } }, windowId, nestGroups(groups));
}

export function splitsWithin(s: Pick<BrowserState, "splits">, tabIds: string[]): SplitView[] {
  const inside = new Set(tabIds);
  return Object.values(s.splits).filter((v) => splitTabIds(v).every((id) => inside.has(id)));
}

export function withSplitsBack(s: BrowserState, kept: SplitView[], windowId: string): BrowserState {
  const taken = new Set(Object.values(s.splits).flatMap((v) => splitTabIds(v)));
  let splits = s.splits;
  for (const v of kept) {
    const profileId = s.tabs[splitTabIds(v)[0]!]?.profileId;
    if (!splitTabIds(v).every((id) => s.tabs[id]?.windowId === windowId && s.tabs[id]?.profileId === profileId && !taken.has(id))) continue;
    const id = splits[v.id] ? newId("split") : v.id;
    splits = { ...splits, [id]: { ...v, id, windowId } };
    splitTabIds(v).forEach((t) => taken.add(t));
  }
  return splits === s.splits ? s : { ...s, splits };
}
