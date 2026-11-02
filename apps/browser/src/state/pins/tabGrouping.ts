import type { BrowserState } from "../browser/store";
import { autoGroupName } from "../groups/groupNames";
import { ancestorIds, canNest, commonGroup, innermostGroupOf, insertAll, leaveGroups, nestGroups, orderSections, placeBlock, placeGroups, reparent, syncGroupOrder, withParent } from "../groups/groups";
import { inPinnedContainer, isIncognitoProfile, isPinnedRow, newId, pinKeyOf } from "../browser/model";
import { splitOf, splitTabIdsOf, withSplitRows } from "../splits/splits";
import { markPinned } from "./pinChoices";
import type { BrowserWindow, Tab, TabGroup } from "../browser/types";

export type GroupPlacement = { pinned: boolean; beforeId?: string | null; parentId?: string | null };

export const groupOf = (s: Pick<BrowserState, "groups">, tabId: string | undefined): TabGroup | undefined =>
  tabId ? innermostGroupOf(s.groups, tabId) : undefined;

const autoLabels = new WeakMap<TabGroup, { tabs: object; members: (Tab | undefined)[]; label: string }>();

export function groupLabel(s: Pick<BrowserState, "tabs">, g: TabGroup): string {
  if (g.name) return g.name;
  const cached = autoLabels.get(g);
  if (cached && (cached.tabs === s.tabs || g.tabIds.every((id, i) => s.tabs[id] === cached.members[i]))) {
    cached.tabs = s.tabs;
    return cached.label;
  }
  const members = g.tabIds.map((id) => s.tabs[id]);
  const label = autoGroupName(members.filter((t): t is Tab => !!t?.url)) || "New Group";
  autoLabels.set(g, { tabs: s.tabs, members, label });
  return label;
}

export function groupWithOpener(s: BrowserState, tabId: string, openerId: string, background: boolean): BrowserState {
  const tab = s.tabs[tabId];
  const opener = s.tabs[openerId];
  if (!tab || !opener) return s;
  if (opener.windowId !== tab.windowId || opener.profileId !== tab.profileId) return s;
  const w = s.windows[tab.windowId]!;
  if (inPinnedContainer(s, openerId)) {
    const gathered = pinnedChildGroup(s, openerId, tab.profileId);
    if (gathered) return joinGroup(s, w, gathered, tabId);
    if (!background || !s.settings.cmdClickCreatesTabGroup) return s;
    return withGroup(s, [tabId], { autoUngroup: true, pinnedOpenerId: openerId })[0];
  }
  const existing = groupOf(s, openerId);
  if (!existing && !(background && s.settings.cmdClickCreatesTabGroup)) return s;
  if (existing) return joinGroup(s, w, existing, tabId);
  const panes = splitTabIdsOf(splitOf(s, openerId)) ?? [openerId];
  return withGroup(s, [...panes, tabId], { autoUngroup: true })[0];
}

export const pinnedChildGroup = (s: Pick<BrowserState, "groups">, openerId: string, profileId: string): TabGroup | undefined =>
  Object.values(s.groups).find((g) => g.pinnedOpenerId === openerId && g.profileId === profileId && g.tabIds.length);

function joinGroup(s: BrowserState, w: BrowserWindow, group: TabGroup, tabId: string): BrowserState {
  const members = [...group.tabIds, tabId];
  const window = { ...w, tabIds: placeBlock(w.tabIds, w.tabIds.filter((id) => members.includes(id))) };
  const groups = { ...s.groups, [group.id]: { ...group, tabIds: window.tabIds.filter((id) => members.includes(id)) } };
  return { ...s, groups, windows: { ...s.windows, [w.id]: window } };
}

export function withGroup(
  s: BrowserState,
  ids: string[],
  o: { name?: string; pinned?: boolean; autoUngroup?: boolean; pinnedOpenerId?: string; parentId?: string | null } = {},
): [BrowserState, string] {
  const tabs = withSplitRows(s, ids).map((id) => s.tabs[id]).filter((t): t is Tab => !!t && !t.pin);
  const first = tabs[0];
  if (!first || tabs.some((t) => t.windowId !== first.windowId || t.profileId !== first.profileId)) return [s, ""];
  const w = s.windows[first.windowId]!;
  const members = new Set(tabs.map((t) => t.id));
  const asked = o.parentId ? s.groups[o.parentId] : undefined;
  const container =
    o.parentId === undefined
      ? commonGroup(s.groups, [...members])
      : asked && asked.windowId === w.id && asked.profileId === first.profileId
        ? asked
        : undefined;
  const keep = new Set(container ? [container.id, ...ancestorIds(s.groups, container.id)] : []);
  let tabIds = placeBlock(w.tabIds, w.tabIds.filter((id) => members.has(id)));
  const group: TabGroup = {
    id: newId("g"),
    windowId: w.id,
    profileId: first.profileId,
    name: o.name ?? "",
    icon: null,
    color: null,
    collapsed: false,
    pinned: container ? container.pinned : !!o.pinned,
    tabIds: tabIds.filter((id) => members.has(id)),
    createdAt: Date.now(),
    ...(o.autoUngroup ? { autoUngroup: true } : {}),
    ...(o.pinnedOpenerId ? { pinnedOpenerId: o.pinnedOpenerId } : {}),
    ...(container ? { parentId: container.id } : {}),
  };
  const groups = nestGroups({ ...leaveGroups(s.groups, members, keep), [group.id]: group });
  tabIds = orderSections(placeGroups(tabIds, groups, w.id), s.tabs, groups);
  const window = { ...w, tabIds };
  return [{ ...s, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } }, group.id];
}

export function withRowsGrouped(s: BrowserState, asked: string[], o: { name?: string; pinned?: boolean }): [BrowserState, string] {
  const ids = withSplitRows(s, asked);
  const rows = ids.filter((id) => isPinnedRow(s.tabs[id]));
  if (!rows.length) return withGroup(s, ids, o);
  const tabs = { ...s.tabs };
  for (const id of rows) {
    tabs[id] = { ...tabs[id]!, pin: null };
  }
  const [next, id] = withGroup({ ...s, tabs }, ids, { ...o, pinned: true });
  const g = next.groups[id];
  if (!g) return [s, ""];
  if (isIncognitoProfile(g.profileId)) return [next, id];
  const placed = g.tabIds.map((tabId) => (next.tabs[tabId] ? pinKeyOf(next.tabs[tabId]!) : tabId));
  return [{ ...next, pinChoices: markPinned(next.pinChoices, g.profileId, { groups: [pinKeyOf(g)], placed }) }, id];
}

export function canMoveGroup(groups: Record<string, TabGroup>, groupId: string, p: Pick<GroupPlacement, "parentId" | "beforeId">): boolean {
  const g = groups[groupId];
  if (!g || (p.beforeId && g.tabIds.includes(p.beforeId))) return false;
  if (p.parentId && (!groups[p.parentId] || !canNest(groups, groupId, p.parentId))) return false;
  const staying = new Set(p.parentId ? [p.parentId, ...ancestorIds(groups, p.parentId)] : []);
  const moving = new Set(g.tabIds);
  return ancestorIds(groups, groupId).every((a) => staying.has(a) || groups[a]!.tabIds.some((id) => !moving.has(id)));
}

export function movingGroup(s: BrowserState, groupId: string, p: GroupPlacement): Partial<BrowserState> {
  const g = s.groups[groupId];
  const w = g && s.windows[g.windowId];
  if (!g || !w || !canMoveGroup(s.groups, groupId, p)) return {};
  const parent = p.parentId ? s.groups[p.parentId] : undefined;
  const pinned = parent ? parent.pinned : p.pinned;
  const moving = new Set(g.tabIds);
  let groups = { ...s.groups };
  const staying = new Set(parent ? [parent.id, ...ancestorIds(s.groups, parent.id)] : []);
  for (const a of ancestorIds(s.groups, groupId)) {
    if (staying.has(a)) continue;
    groups[a] = { ...groups[a]!, tabIds: groups[a]!.tabIds.filter((id) => !moving.has(id)) };
  }
  groups[groupId] = withParent({ ...g, pinned }, parent?.id);
  groups = nestGroups(reparent(groups, s.groups));
  let pinChoices = s.pinChoices;
  if (pinned && !g.pinned && !isIncognitoProfile(g.profileId)) {
    const placed = g.tabIds.flatMap((id) => (s.tabs[id] ? [pinKeyOf(s.tabs[id]!)] : []));
    pinChoices = markPinned(pinChoices, g.profileId, { groups: [pinKeyOf(g)], placed });
  }
  const rest = w.tabIds.filter((id) => !moving.has(id));
  let at: number;
  if (p.beforeId && rest.includes(p.beforeId)) {
    const inner = innermostGroupOf(groups, p.beforeId);
    const chain = inner ? [inner.id, ...ancestorIds(groups, inner.id)] : [];
    const block = chain.map((id) => groups[id]!).find((x) => x.parentId === parent?.id && x.id !== parent?.id);
    at = rest.indexOf(block ? block.tabIds.find((id) => rest.includes(id))! : p.beforeId);
  } else if (parent) {
    const kept = groups[parent.id]!.tabIds.filter((id) => rest.includes(id));
    at = kept.length ? rest.indexOf(kept.at(-1)!) + 1 : Math.min(w.tabIds.indexOf(g.tabIds[0]!), rest.length);
  } else if (pinned) {
    const pinnedGroup = new Set(Object.values(groups).filter((x) => x.pinned && !moving.has(x.tabIds[0] ?? "")).flatMap((x) => x.tabIds));
    at = rest.reduce((last, id, i) => (s.tabs[id]?.pin || pinnedGroup.has(id) ? i + 1 : last), 0);
  } else at = rest.length;
  insertAll(rest, at, g.tabIds);
  const window = { ...w, tabIds: orderSections(placeGroups(rest, groups, w.id), s.tabs, groups) };
  return { groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window }, pinChoices };
}
