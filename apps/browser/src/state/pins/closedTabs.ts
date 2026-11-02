import type { BrowserState } from "../browser/store";
import { ancestorIds, closedGroupInfo, descendantIds, innermostGroupOf, insertAll, nestGroups, orderSections, placeGroups, rejoinGroups, syncGroupOrder } from "../groups/groups";
import { inPinnedContainer, newId, snapshotTab, viewTabIds } from "../browser/model";
import { pendingRestore, restoreId } from "../tabs/adoptIds";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import { groupLabel, withGroup } from "./tabGrouping";
import type { BrowserWindow, ClosedGroup, ClosedTab, ClosedWindow, NestedGroupSnapshot, Tab, TabGroup } from "../browser/types";
import { isAsleep } from "../tabs/pageSession";

export const MAX_CLOSED_TABS = 50;
export const MAX_CLOSED_WINDOWS = 10;
const MAX_CLOSED_GROUPS = 20;
const PURGED_AFTER_MS = 7 * 86_400_000;
function keptAWeek<T extends { closedAt: number }>(list: T[], now: number): T[] {
  const kept = list.filter((c) => now - c.closedAt < PURGED_AFTER_MS);
  return kept.length === list.length ? list : kept;
}
export const keptDeletedGroups = (list: ClosedGroup[], now = Date.now()) => keptAWeek(list, now);
export const keptCleanedTabs = (list: ClosedTab[], now = Date.now()) => keptAWeek(list, now);

export const cleanedTabsFor = (s: Pick<BrowserState, "windows" | "cleanedTabs" | "privateCleanedTabs">, windowId: string): ClosedTab[] =>
  keptCleanedTabs(s.windows[windowId]?.kind === "private" ? (s.privateCleanedTabs[windowId] ?? NO_CLEANED) : s.cleanedTabs);
const NO_CLEANED: ClosedTab[] = [];

export function closedTabEntry(s: Pick<BrowserState, "groups">, t: Tab, at: { windowId: string; index: number }, closedAt: number, group: TabGroup | null | undefined = innermostGroupOf(s.groups, t.id)): ClosedTab {
  const parents = group ? ancestorIds(s.groups, group.id).map((id) => closedGroupInfo(s.groups[id]!)) : [];
  return {
    kind: "tab",
    id: newId("ct"),
    tab: snapshotTab(t),
    tabId: t.id,
    ...(pendingRestore(t) ? { restoreFrom: pendingRestore(t) } : {}),
    windowId: at.windowId,
    index: at.index,
    group: group ? closedGroupInfo(group) : null,
    ...(parents.length ? { parents } : {}),
    closedAt,
  };
}

export const closedWindowEntry = (w: BrowserWindow, tabs: ClosedWindow["tabs"], groups: ClosedWindow["groups"], closedAt: number): ClosedWindow => ({
  kind: "window",
  id: newId("cw"),
  window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
  tabs,
  groups,
  closedAt,
});

export function closedEntries(s: BrowserState, ids: string[]): ClosedTab[] {
  const now = Date.now();
  return ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && !!t.url)
    .map((t) => closedTabEntry(s, t, { windowId: t.windowId, index: s.windows[t.windowId]?.tabIds.indexOf(t.id) ?? 0 }, now));
}

export function closeQuietly(s: BrowserState, ids: string[]): BrowserState {
  for (const w of Object.values(s.windows)) {
    const view = viewTabIds(s, w.id);
    if (view.length && view.every((id) => ids.includes(id))) s = withNewTab(s, w.id)[0];
  }
  return removeTabs(s, ids, false);
}

function showAboveGroup(before: BrowserState, s: BrowserState, g: TabGroup): BrowserState {
  const w = s.windows[g.windowId];
  const was = before.windows[g.windowId]?.activeTabIds[g.profileId];
  if (!w || !was || !g.tabIds.includes(was)) return s;
  const order = viewTabIds(before, g.windowId, g.profileId).filter((id) => !inPinnedContainer(before, id));
  const at = order.indexOf(g.tabIds[0]!);
  const stays = (id: string) => !!s.tabs[id] && !g.tabIds.includes(id) && !isAsleep(s.tabs[id]);
  const pick = order.slice(0, at).reverse().find(stays) ?? order.slice(at).find(stays);
  if (!pick) return s;
  if (w.profileId === g.profileId) return apply(s, activated(s, pick));
  return { ...s, windows: { ...s.windows, [w.id]: { ...w, activeTabIds: { ...w.activeTabIds, [g.profileId]: pick } } } };
}

export function closingGroup(s: BrowserState, groupId: string, deleted = false): BrowserState {
  let g = s.groups[groupId];
  for (let p = g?.parentId ? s.groups[g.parentId] : undefined; g && p?.tabIds.length === g.tabIds.length; p = p.parentId ? s.groups[p.parentId] : undefined) g = p;
  const w = g && s.windows[g.windowId];
  if (!g || !w) return s;
  const nested = nestedSnapshot(s, g);
  const entry: ClosedGroup = {
    kind: "group",
    id: newId("cg"),
    group: { id: g.id, name: groupLabel(s, g), icon: g.icon, color: g.color, pinned: g.pinned, ...(g.parentId ? { parentId: g.parentId } : {}) },
    tabs: g.tabIds.map((id) => snapshotTab(s.tabs[id]!)),
    tabIds: g.tabIds.map((id) => pendingRestore(s.tabs[id]!) ?? id),
    ...(nested.length ? { nested } : {}),
    windowId: w.id,
    index: w.tabIds.indexOf(g.tabIds[0]!),
    closedAt: Date.now(),
  };
  const recordable = w.kind !== "private" && entry.tabs.some((t) => t.url);
  const next = showAboveGroup(s, closeQuietly(s, g.tabIds), g);
  if (!recordable) return next;
  if (deleted) return { ...next, deletedGroups: [...keptDeletedGroups(next.deletedGroups), entry] };
  return { ...next, closedGroups: [...next.closedGroups, entry].slice(-MAX_CLOSED_GROUPS) };
}

export function nestedSnapshot(s: Pick<BrowserState, "groups">, g: TabGroup): NestedGroupSnapshot[] {
  return descendantIds(s.groups, g.id).map((id) => {
    const c = s.groups[id]!;
    return {
      id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      collapsed: c.collapsed,
      parentId: c.parentId!,
      tabIndexes: c.tabIds.map((t) => g.tabIds.indexOf(t)).filter((i) => i >= 0),
    };
  });
}

export function rebuildNested(s: BrowserState, rootId: string, rootKey: string, ids: string[], nested: NestedGroupSnapshot[] | undefined): BrowserState {
  const root = s.groups[rootId];
  if (!root || !nested?.length) return s;
  const made = new Map([[rootKey, rootId]]);
  const groups = { ...s.groups };
  for (const n of nested) {
    const parentId = made.get(n.parentId);
    const tabIds = n.tabIndexes.map((i) => ids[i]).filter((id): id is string => !!id && !!s.tabs[id]);
    if (!parentId || !tabIds.length) continue;
    const id = groups[n.id] ? newId("g") : n.id;
    made.set(n.id, id);
    groups[id] = { id, windowId: root.windowId, profileId: root.profileId, name: n.name, icon: n.icon, color: n.color, collapsed: n.collapsed, pinned: root.pinned, tabIds, createdAt: Date.now(), parentId };
  }
  const settled = nestGroups(groups);
  const w = s.windows[root.windowId]!;
  const window = { ...w, tabIds: placeGroups(w.tabIds, settled, w.id) };
  return { ...s, groups: syncGroupOrder(settled, window), windows: { ...s.windows, [w.id]: window } };
}

export function restoreSnapshots(
  s: BrowserState,
  windowId: string,
  entries: { tab: ClosedTab["tab"]; tabId?: string; index?: number }[],
): [BrowserState, string[]] {
  const ids: string[] = [];
  const w = s.windows[windowId]!;
  for (const e of entries) {
    const profileId = s.profiles[e.tab.profileId] || w.kind === "private" ? e.tab.profileId : w.profileId;
    const [next, id] = withNewTab(s, windowId, {
      url: e.tab.url || undefined,
      profileId,
      snapshot: e.tab,
      index: e.index,
      background: true,
      wakeAdoptId: e.tabId && e.tab.url ? restoreId(e.tabId) : undefined,
    });
    s = next;
    ids.push(id);
  }
  return [s, ids];
}

export function regroupRestored(s: BrowserState, windowId: string, entries: ClosedTab[], ids: string[]): BrowserState {
  const byGroup = new Map<string, { info: NonNullable<ClosedTab["group"]>; members: string[] }>();
  entries.forEach((e, i) => {
    const id = ids[i];
    if (!e.group || !id) return;
    const g = byGroup.get(e.group.id) ?? { info: e.group, members: [] };
    g.members.push(id);
    byGroup.set(e.group.id, g);
  });
  const parentsOf = new Map<string, NonNullable<ClosedTab["parents"]>>();
  for (const e of entries) if (e.group && e.parents?.length && !parentsOf.has(e.group.id)) parentsOf.set(e.group.id, e.parents);
  const made = new Map<string, string>();
  for (const { info, members } of byGroup.values()) {
    const profileId = s.tabs[members[0]!]!.profileId;
    s = { ...s, groups: rejoinGroups(s.groups, [info, ...(parentsOf.get(info.id) ?? [])], members, windowId, profileId, made) };
  }
  const groups = nestGroups(s.groups);
  const w = s.windows[windowId]!;
  const window = { ...w, tabIds: placeGroups(w.tabIds, groups, windowId) };
  return { ...s, windows: { ...s.windows, [windowId]: window }, groups: syncGroupOrder(groups, window) };
}

export function restoreTarget(s: BrowserState, original: string, requested?: string | null): string | undefined {
  const ok = (id: string | null | undefined) => !!id && !!s.windows[id] && s.windows[id]!.kind !== "private";
  if (ok(original)) return original;
  if (ok(requested)) return requested!;
  return s.ui.focusOrder.find((id) => ok(id)) ?? s.windowOrder.find((id) => ok(id));
}

function atSavedIndex(s: BrowserState, windowId: string, block: string[], index: number): BrowserState {
  const w = s.windows[windowId];
  if (!w) return s;
  const members = new Set(block);
  const rest = w.tabIds.filter((id) => !members.has(id));
  insertAll(rest, Math.min(index, rest.length), block);
  const window = { ...w, tabIds: orderSections(rest, s.tabs, s.groups) };
  return { ...s, windows: { ...s.windows, [windowId]: window }, groups: syncGroupOrder(s.groups, window) };
}

export function restoringGroup(s: BrowserState, entry: ClosedGroup, requested?: string | null): BrowserState {
  const windowId = restoreTarget(s, entry.windowId, requested);
  if (!windowId) return s;
  let next: BrowserState = {
    ...s,
    closedGroups: s.closedGroups.filter((c) => c.id !== entry.id),
    deletedGroups: s.deletedGroups.filter((c) => c.id !== entry.id),
  };
  const index = windowId === entry.windowId ? entry.index : undefined;
  const [restored, ids] = restoreSnapshots(
    next,
    windowId,
    entry.tabs.map((tab, i) => ({ tab: { ...tab, pin: null }, tabId: entry.tabIds?.[i], index: index === undefined ? undefined : index + i })),
  );
  next = restored;
  const home = entry.group.parentId ? next.groups[entry.group.parentId] : undefined;
  const parent = home && home.windowId === windowId ? home : undefined;
  const [grouped, groupId] = withGroup(next, ids, { name: entry.group.name, pinned: entry.group.pinned, parentId: parent?.id ?? null });
  next = grouped;
  if (groupId && next.groups[groupId]) {
    next = { ...next, groups: { ...next.groups, [groupId]: { ...next.groups[groupId]!, icon: entry.group.icon, color: entry.group.color } } };
    next = rebuildNested(next, groupId, entry.group.id, ids, entry.nested);
    if (index !== undefined && entry.group.pinned && !parent) next = atSavedIndex(next, windowId, next.groups[groupId]!.tabIds, index);
  }
  return ids[0] ? apply(next, activated(next, ids[0])) : next;
}
