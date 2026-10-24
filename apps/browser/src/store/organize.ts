import type { StateCreator } from "zustand";
import type { BrowserState } from "./browser";
import { autoGroupName } from "./groupNames";
import { ancestorIds, canNest, commonGroup, descendantIds, innermostGroupOf, insertAll, leaveGroups, nestGroups, orderSections, placeBlock, placeGroups, rejoinGroups, reparent, syncGroupOrder, withGroupsPlaced, withParent } from "./groups";
import { activeTabId, bookmarkProfileId, inPinnedContainer, isIncognitoProfile, isPinnedRow, newId, pendingRestore, restoreId, snapshotTab, viewTabIds, without } from "./model";
import { splitOf, splitRowHead, splitRowPanes, withSplitRows } from "./splits";
import { lastUsedOf, sharedLastUsed } from "./tabShare";
import { activated, apply, removeTabs, withNewTab } from "./tabs";
import type { BrowserWindow, ClosedGroup, ClosedTab, NestedGroupSnapshot, Tab, TabGroup, TileFolder } from "./types";

export type TabPlacement = {
  pinned: boolean;
  row?: boolean;
  beforeId?: string | null;
  groupId?: string | null;
  last?: boolean;
  tileFolder?: TileFolder | null;
};

export type GroupPlacement = { pinned: boolean; beforeId?: string | null; parentId?: string | null };

export type PinChoices = Record<string, Record<string, number>>;

let lastPinChoice = 0;
export const nextPinChoice = () => (lastPinChoice = Math.max(Date.now(), lastPinChoice + 1));
export const groupChoiceKey = (key: string) => `group:${key}`;
export const placeChoiceKey = (key: string) => `place:${key}`;
export const orderChoiceKey = (key: string) => `order:${key}`;

export function notePinChoices(choices: PinChoices) {
  for (const mine of Object.values(choices)) for (const n of Object.values(mine)) if (n > lastPinChoice) lastPinChoice = n;
}

export type PinSyncEntry = { g?: string; w?: number };
export type PinSync = Record<string, Record<string, PinSyncEntry>>;

export function livePinTable<T>(table: Record<string, Record<string, T>>, s: Pick<BrowserState, "profiles" | "tabs" | "groups" | "parkedPins">): Record<string, Record<string, T>> {
  const profiles = Object.keys(table);
  if (!profiles.length) return table;
  const pinned = new Map<string, Set<string>>();
  const add = (profileId: string, key: string) => {
    let keys = pinned.get(profileId);
    if (!keys) pinned.set(profileId, (keys = new Set()));
    keys.add(key);
  };
  const members = new Set<string>();
  for (const g of Object.values(s.groups)) {
    if (!g.pinned) continue;
    add(g.profileId, groupChoiceKey(g.pinKey ?? g.id));
    add(g.profileId, orderChoiceKey(g.pinKey ?? g.id));
    for (const id of g.tabIds) members.add(id);
  }
  for (const t of Object.values(s.tabs)) if (t.pinned || members.has(t.id)) (add(t.profileId, t.pinKey ?? t.id), add(t.profileId, placeChoiceKey(t.pinKey ?? t.id)));
  for (const [profileId, park] of Object.entries(s.parkedPins)) {
    for (const p of park.tabs) (add(profileId, p.id), add(profileId, placeChoiceKey(p.id)));
    for (const g of park.groups) {
      add(profileId, groupChoiceKey(g.id));
      add(profileId, orderChoiceKey(g.id));
    }
  }
  let changed = false;
  const out: Record<string, Record<string, T>> = {};
  for (const profileId of profiles) {
    const mine = table[profileId]!;
    const keys = s.profiles[profileId] ? pinned.get(profileId) : undefined;
    const kept = Object.fromEntries(Object.entries(mine).filter(([key]) => keys?.has(key)));
    const n = Object.keys(kept).length;
    if (!n || n !== Object.keys(mine).length) changed = true;
    if (n) out[profileId] = n === Object.keys(mine).length ? mine : (kept as Record<string, T>);
  }
  return changed ? out : table;
}

export type OrganizeSlice = {
  selection: Record<string, string[]>;
  pinChoices: PinChoices;
  pinSync: PinSync;
  cleanedTabs: ClosedTab[];
  privateCleanedTabs: Record<string, ClosedTab[]>;
  privateSiteMutes: Record<string, Record<string, boolean>>;
  closedGroups: ClosedGroup[];
  deletedGroups: ClosedGroup[];

  setSelection(windowId: string, ids: string[]): void;
  placeTabs(ids: string[], placement: TabPlacement): void;
  pinTabs(ids: string[], pinned: boolean, row?: boolean): void;
  returnToPinnedUrl(tabId: string): void;
  setPinnedUrl(tabId: string, url?: string): void;
  setMuted(ids: string[], muted: boolean): void;
  setSiteMuted(tabId: string, muted: boolean): void;

  groupTabs(ids: string[], options?: { pinned?: boolean; name?: string }): string;
  groupOnto(ids: string[], targetId: string): string;
  moveGroup(groupId: string, placement: GroupPlacement): void;
  duplicateGroup(groupId: string): string;
  newTabInGroup(groupId: string): string;
  moveGroupToBookmarksBar(groupId: string): void;

  cleanUpTabs(windowId: string, options?: { inactiveForMs?: number }): number;
  restoreCleaned(entryId?: string, windowId?: string): void;
  clearUnpinnedTabs(windowId: string): ClearedTabs | null;
  undoClearTabs(cleared: ClearedTabs): void;
  closeAbandonedNewTabs(): void;
};

export type ClearedTabs = { windowId: string; entries: ClosedTab[]; shownTabId: string | null; blankTabId: string | null };

export function unpinnedTabIds(s: BrowserState, windowId: string): string[] {
  return viewTabIds(s, windowId).filter((id) => !inPinnedContainer(s, id));
}

const CLEAN_UP_AFTER_MS = 12 * 60 * 60 * 1000;
const MAX_CLEANED = 100;
const MAX_CLOSED_GROUPS = 20;
const PURGED_AFTER_MS = 7 * 86_400_000;
function keptAWeek<T extends { closedAt: number }>(list: T[], now: number): T[] {
  const kept = list.filter((c) => now - c.closedAt < PURGED_AFTER_MS);
  return kept.length === list.length ? list : kept;
}
export const keptDeletedGroups = (list: ClosedGroup[], now = Date.now()) => keptAWeek(list, now);
export const keptCleanedTabs = (list: ClosedTab[], now = Date.now()) => keptAWeek(list, now);

export const groupOf = (s: Pick<BrowserState, "groups">, tabId: string | undefined): TabGroup | undefined =>
  tabId ? innermostGroupOf(s.groups, tabId) : undefined;

export function selectedTabIds(s: BrowserState, windowId: string): string[] {
  const view = viewTabIds(s, windowId);
  const selected = (s.selection[windowId] ?? []).filter((id) => view.includes(id));
  if (selected.length) return view.filter((id) => selected.includes(id));
  const active = activeTabId(s, windowId);
  return active ? [active] : [];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function samePage(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
  return norm(a) === norm(b);
}

export const awayFromPin = (t: Pick<Tab, "pinned" | "url" | "pinnedUrl">) =>
  t.pinned && !!t.pinnedUrl && !!t.url && !samePage(t.url, t.pinnedUrl);

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

function isSiteMuted(s: Pick<BrowserState, "settings" | "privateSiteMutes">, tab: Pick<Tab, "windowId" | "profileId">, host: string): boolean {
  const own = isIncognitoProfile(tab.profileId) ? s.privateSiteMutes[tab.windowId]?.[host] : undefined;
  return own ?? (s.settings.mutedSites ?? []).includes(host);
}

export const cleanedTabsFor = (s: Pick<BrowserState, "windows" | "cleanedTabs" | "privateCleanedTabs">, windowId: string): ClosedTab[] =>
  keptCleanedTabs(s.windows[windowId]?.incognito ? (s.privateCleanedTabs[windowId] ?? NO_CLEANED) : s.cleanedTabs);
const NO_CLEANED: ClosedTab[] = [];

export function onUrlChange(s: BrowserState, tab: Tab, url: string): Partial<Tab> {
  const patch: Partial<Tab> = {};
  const before = hostOf(tab.url);
  const after = hostOf(url);
  if (before !== after) {
    if (isSiteMuted(s, tab, after)) patch.muted = true;
    else if (isSiteMuted(s, tab, before)) patch.muted = false;
  }
  if (tab.pinned && !tab.pinnedUrl && url) patch.pinnedUrl = url;
  return patch;
}

export function pruneSelection(selection: Record<string, string[]>, gone: Set<string>): Record<string, string[]> {
  if (!Object.values(selection).some((ids) => ids.some((id) => gone.has(id)))) return selection;
  return Object.fromEntries(Object.entries(selection).map(([w, ids]) => [w, ids.filter((id) => !gone.has(id))]));
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
  const panes = Object.values(s.splits).find((v) => v.tabIds.includes(openerId))?.tabIds ?? [openerId];
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
  const tabs = withSplitRows(s, ids).map((id) => s.tabs[id]).filter((t): t is Tab => !!t && !t.pinned);
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
    const { pinnedAsRow: _, ...rest } = tabs[id]!;
    tabs[id] = { ...rest, pinned: false, pinnedUrl: null };
  }
  const [next, id] = withGroup({ ...s, tabs }, ids, { ...o, pinned: true });
  const g = next.groups[id];
  if (!g) return [s, ""];
  if (isIncognitoProfile(g.profileId)) return [next, id];
  const mine = { ...next.pinChoices[g.profileId], [groupChoiceKey(g.pinKey ?? g.id)]: nextPinChoice() };
  for (const tabId of g.tabIds) mine[placeChoiceKey(next.tabs[tabId]?.pinKey ?? tabId)] = nextPinChoice();
  return [{ ...next, pinChoices: { ...next.pinChoices, [g.profileId]: mine } }, id];
}

function closedEntries(s: BrowserState, ids: string[]): ClosedTab[] {
  const now = Date.now();
  return ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && !!t.url)
    .map((t) => {
      const group = groupOf(s, t.id);
      const parents = group ? ancestorIds(s.groups, group.id).map((id) => s.groups[id]!).map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color })) : [];
      return {
        kind: "tab" as const,
        id: newId("ct"),
        tab: snapshotTab(t),
        tabId: t.id,
        ...(pendingRestore(t) ? { restoreFrom: pendingRestore(t) } : {}),
        windowId: t.windowId,
        index: s.windows[t.windowId]?.tabIds.indexOf(t.id) ?? 0,
        group: group ? { id: group.id, name: group.name, icon: group.icon, color: group.color } : null,
        ...(parents.length ? { parents } : {}),
        closedAt: now,
      };
    });
}

function closeQuietly(s: BrowserState, ids: string[]): BrowserState {
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
  const stays = (id: string) => !!s.tabs[id] && !g.tabIds.includes(id) && !s.tabs[id]!.unloaded;
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
  const recordable = !w.incognito && entry.tabs.some((t) => t.url);
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
    const profileId = s.profiles[e.tab.profileId] || w.incognito ? e.tab.profileId : w.profileId;
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

function regroupRestored(s: BrowserState, windowId: string, entries: ClosedTab[], ids: string[]): BrowserState {
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

function restoreTarget(s: BrowserState, original: string, requested?: string | null): string | undefined {
  const ok = (id: string | null | undefined) => !!id && !!s.windows[id] && !s.windows[id]!.incognito;
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
    entry.tabs.map((tab, i) => ({ tab: { ...tab, pinned: false }, tabId: entry.tabIds?.[i], index: index === undefined ? undefined : index + i })),
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

export function cleanUpCandidates(s: BrowserState, windowId: string, inactiveForMs = CLEAN_UP_AFTER_MS, now = Date.now()): string[] {
  const view = viewTabIds(s, windowId);
  const active = activeTabId(s, windowId);
  const grouped = new Set(Object.values(s.groups).flatMap((g) => g.tabIds));
  const inSplit = new Set(Object.values(s.splits).flatMap((v) => v.tabIds));
  const keep = (t: Tab) => t.id === active || inPinnedContainer(s, t.id) || s.live[t.id]?.playingAudio;
  const used = sharedLastUsed(s);
  const out = new Set<string>();
  const byPage = new Map<string, Tab[]>();
  for (const id of view) {
    const t = s.tabs[id]!;
    if (!t.url) continue;
    const key = t.url.replace(/#.*$/, "");
    byPage.set(key, [...(byPage.get(key) ?? []), t]);
  }
  for (const same of byPage.values()) {
    if (same.length < 2) continue;
    const keeper = same.find((t) => t.pinned) ?? same.find((t) => t.id === active) ?? [...same].sort((a, b) => lastUsedOf(used, b) - lastUsedOf(used, a))[0]!;
    for (const t of same) if (t !== keeper && !keep(t) && !inSplit.has(t.id)) out.add(t.id);
  }
  for (const id of view) {
    const t = s.tabs[id]!;
    if (keep(t) || grouped.has(id) || inSplit.has(id)) continue;
    if (now - lastUsedOf(used, t) >= inactiveForMs) out.add(id);
  }
  return view.filter((id) => out.has(id));
}

function abandonedNewTabs(s: BrowserState, windowId: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const selected = new Set(Object.values(w.activeTabIds));
  const shown = w.activeTabIds[w.profileId];
  const out = w.tabIds.filter((id) => {
    const t = s.tabs[id];
    return !!t && t.windowId === w.id && !t.url && !t.navigation && !t.adoptId && !t.pinned && id !== shown && !selected.has(id);
  });
  return out.length >= w.tabIds.length ? out.slice(0, w.tabIds.length - 1) : out;
}

export function recentTabIds(s: BrowserState, windowId: string, now = Date.now(), staleAfterMs = CLEAN_UP_AFTER_MS): string[] {
  const view = viewTabIds(s, windowId).map((id) => s.tabs[id]!);
  const sorted = view.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return sorted.filter((t, i) => i < 2 || now - t.lastActiveAt < staleAfterMs).map((t) => t.id);
}

export function placing(s: BrowserState, ids: string[], p: TabPlacement): BrowserState {
  const first = s.tabs[ids[0] ?? ""];
  const w = first && s.windows[first.windowId];
  if (!first || !w) return s;
  const order = new Map(w.tabIds.map((id, i) => [id, i]));
  const moving = [...new Set(withSplitRows(s, ids))]
    .filter((id) => s.tabs[id]?.windowId === w.id && s.tabs[id]?.profileId === first.profileId)
    .sort((a, b) => order.get(a)! - order.get(b)!);
  if (!moving.length) return s;
  const paired = new Set(moving.filter((id) => splitRowPanes(s, splitOf(s, id)).includes(id)));
  const target = !p.pinned && p.groupId ? s.groups[p.groupId] : undefined;
  if (target && (target.windowId !== w.id || target.profileId !== first.profileId)) return s;
  const movingSet = new Set(moving);

  const tabs = { ...s.tabs };
  let chosen: Record<string, number> | null = null;
  let pinSync = s.pinSync;
  const pinnedGroupOf = (id: string) => {
    const g = innermostGroupOf(s.groups, id);
    return g?.pinned ? g.id : null;
  };
  const intoPinnedGroup = target?.pinned ? target.id : null;
  for (const id of moving) {
    const t = tabs[id]!;
    if (t.pinned !== p.pinned) tabs[id] = { ...t, pinned: p.pinned, pinnedUrl: p.pinned ? t.url || null : null };
    const row = p.pinned && (paired.has(id) || (p.row ?? (t.pinned && !!t.pinnedAsRow)));
    const placed = t.pinned !== p.pinned || (!p.pinned && pinnedGroupOf(id) !== intoPinnedGroup);
    if (placed || !!t.pinnedAsRow !== row) {
      const { pinnedAsRow: _, ...rest } = tabs[id]!;
      tabs[id] = row ? { ...rest, pinnedAsRow: true } : rest;
      const entry = placed ? pinSync[t.profileId]?.[t.pinKey ?? t.id] : undefined;
      if (entry?.g) {
        const { g: __, w: ___, ...kept } = entry;
        pinSync = { ...pinSync, [t.profileId]: { ...pinSync[t.profileId], [t.pinKey ?? t.id]: kept } };
      }
      if ((p.pinned || intoPinnedGroup) && !isIncognitoProfile(t.profileId)) {
        chosen ??= { ...s.pinChoices[t.profileId] };
        if (p.pinned) chosen[t.pinKey ?? t.id] = nextPinChoice();
        if (placed) chosen[placeChoiceKey(t.pinKey ?? t.id)] = nextPinChoice();
      }
    }
    const folder = p.pinned && !row ? (p.tileFolder === undefined ? tabs[id]!.tileFolder : (p.tileFolder ?? undefined)) : undefined;
    if (tabs[id]!.tileFolder !== folder) {
      const { tileFolder: _, ...kept } = tabs[id]!;
      tabs[id] = folder ? { ...kept, tileFolder: folder } : kept;
    }
  }
  const rest = w.tabIds.filter((id) => !movingSet.has(id));
  let at: number;
  if (p.beforeId && rest.includes(p.beforeId)) at = rest.indexOf(splitRowHead(s, rest, p.beforeId));
  else if (target) {
    const kept = target.tabIds.filter((id) => !movingSet.has(id));
    at = kept.length ? rest.indexOf(kept.at(-1)!) + 1 : Math.min(order.get(target.tabIds[0]!)!, rest.length);
  } else if (p.pinned) {
    const toRow = !!tabs[moving[0]!]!.pinnedAsRow;
    const pinnedGroup = toRow && p.last ? new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds)) : null;
    at = rest.reduce((last, id, i) => ((tabs[id]?.pinned && (toRow || !tabs[id]!.pinnedAsRow)) || pinnedGroup?.has(id) ? i + 1 : last), 0);
  } else at = rest.length;
  insertAll(rest, at, moving);

  let groups = leaveGroups(s.groups, movingSet);
  if (target) {
    const kept = groups[target.id] ?? target;
    const members = new Set([...kept.tabIds, ...moving]);
    groups = { ...groups, [target.id]: { ...kept, tabIds: rest.filter((id) => members.has(id)) } };
    for (const a of ancestorIds(s.groups, target.id)) if (!groups[a] && s.groups[a]) groups[a] = { ...s.groups[a]!, tabIds: [] };
    groups = reparent(groups, s.groups);
  }
  groups = nestGroups(groups);
  let tabIds = placeGroups(rest, groups, w.id);
  tabIds = orderSections(tabIds, tabs, groups);
  const window: BrowserWindow = { ...w, tabIds };
  const pinChoices = chosen ? { ...s.pinChoices, [first.profileId]: chosen } : s.pinChoices;
  return { ...s, tabs, pinChoices, pinSync, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } };
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
    const mine = { ...pinChoices[g.profileId], [groupChoiceKey(g.pinKey ?? g.id)]: nextPinChoice() };
    for (const id of g.tabIds) if (s.tabs[id]) mine[placeChoiceKey(s.tabs[id]!.pinKey ?? id)] = nextPinChoice();
    pinChoices = { ...pinChoices, [g.profileId]: mine };
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
    at = rest.reduce((last, id, i) => (s.tabs[id]?.pinned || pinnedGroup.has(id) ? i + 1 : last), 0);
  } else at = rest.length;
  insertAll(rest, at, g.tabIds);
  const window = { ...w, tabIds: orderSections(placeGroups(rest, groups, w.id), s.tabs, groups) };
  return { groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window }, pinChoices };
}

export function forgetClosedPrivateWindows(s: BrowserState): Partial<BrowserState> | null {
  const gone = (map: Record<string, unknown>) => Object.keys(map).filter((id) => !s.windows[id]);
  const cleaned = gone(s.privateCleanedTabs);
  const mutes = gone(s.privateSiteMutes);
  if (!cleaned.length && !mutes.length) return null;
  return { privateCleanedTabs: without(s.privateCleanedTabs, cleaned), privateSiteMutes: without(s.privateSiteMutes, mutes) };
}

export const createOrganizeSlice: StateCreator<BrowserState, [], [], OrganizeSlice> = (set, get) => ({
  selection: {},
  pinChoices: {},
  pinSync: {},
  cleanedTabs: [],
  privateCleanedTabs: {},
  privateSiteMutes: {},
  closedGroups: [],
  deletedGroups: [],

  setSelection(windowId, ids) {
    set((s) => {
      const view = new Set(viewTabIds(s, windowId));
      const next = [...new Set(ids)].filter((id) => view.has(id));
      const prev = s.selection[windowId] ?? [];
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return {};
      return { selection: { ...s.selection, [windowId]: next } };
    });
  },

  placeTabs(ids, placement) {
    set((s) => placing(s, ids, placement));
  },

  pinTabs(ids, pinned, row) {
    const s = get();
    const first = s.tabs[ids[0] ?? ""];
    const w = first && s.windows[first.windowId];
    if (!w) return;
    const pinnedGroupMembers = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
    const beforeId = pinned ? null : w.tabIds.find((id) => !s.tabs[id]?.pinned && !pinnedGroupMembers.has(id) && !ids.includes(id));
    set(placing(s, ids, { pinned, row, beforeId }));
  },

  returnToPinnedUrl(tabId) {
    const t = get().tabs[tabId];
    if (!t?.pinnedUrl || samePage(t.url, t.pinnedUrl)) return;
    get().navigate(tabId, t.pinnedUrl);
  },

  setPinnedUrl(tabId, url) {
    const t = get().tabs[tabId];
    const next = url ?? t?.url;
    if (!t?.pinned || !next) return;
    get().updateTab(tabId, { pinnedUrl: next });
    if (url && !samePage(t.url, url)) get().navigate(tabId, url);
  },

  setMuted(ids, muted) {
    set((s) => {
      const tabs = { ...s.tabs };
      let changed = false;
      for (const id of ids) {
        const t = tabs[id];
        if (t && t.muted !== muted) {
          tabs[id] = { ...t, muted };
          changed = true;
        }
      }
      return changed ? { tabs } : {};
    });
  },

  setSiteMuted(tabId, muted) {
    const s = get();
    const tab = s.tabs[tabId];
    if (!tab) return;
    const host = hostOf(tab.url);
    if (!host) return get().setMuted([tabId], muted);
    get().setMuted(
      Object.values(s.tabs)
        .filter((t) => t.profileId === tab.profileId && hostOf(t.url) === host)
        .map((t) => t.id),
      muted,
    );
    if (isIncognitoProfile(tab.profileId)) {
      const own = { ...s.privateSiteMutes[tab.windowId], [host]: muted };
      return set({ privateSiteMutes: { ...get().privateSiteMutes, [tab.windowId]: own } });
    }
    const sites = new Set(s.settings.mutedSites ?? []);
    if (muted) sites.add(host);
    else sites.delete(host);
    get().updateSettings({ mutedSites: [...sites] });
  },

  groupTabs(ids, { pinned = true, name } = {}) {
    const [next, id] = withRowsGrouped(get(), ids, { pinned, name });
    if (id) set({ ...next, selection: { ...next.selection, [next.groups[id]!.windowId]: [] } });
    return id;
  },

  groupOnto(ids, targetId) {
    const s = get();
    const target = s.tabs[targetId];
    const w = target && s.windows[target.windowId];
    if (!w || (target.pinned && !isPinnedRow(target)) || groupOf(s, targetId)) return "";
    const moving = ids.filter((id) => id !== targetId && s.tabs[id]?.windowId === w.id && s.tabs[id]?.profileId === target.profileId);
    if (!moving.length) return "";
    const after = w.tabIds.slice(w.tabIds.indexOf(targetId) + 1).find((id) => !moving.includes(id)) ?? null;
    const [next, id] = withRowsGrouped(placing(s, moving, { pinned: false, beforeId: after }), [targetId, ...moving], { pinned: false });
    if (id) set({ ...next, selection: { ...next.selection, [w.id]: [] } });
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
      g.tabIds.map((id, i) => ({ tab: { ...snapshotTab(s.tabs[id]!), pinned: false }, index: after + i })),
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
        if (t?.url) get().addBookmark({ profileId, url: t.url, title: t.customTitle || t.title || t.url, favicon: t.favicon, parentId: folder });
      }
    };
    file(g);
    set(closingGroup(get(), groupId));
  },

  cleanUpTabs(windowId, options = {}) {
    const s = get();
    const hours = s.settings.cleanUpInactiveTabsAfterHours;
    const ids = cleanUpCandidates(s, windowId, options.inactiveForMs ?? (hours ? hours * 3_600_000 : CLEAN_UP_AFTER_MS));
    if (!ids.length) return 0;
    const entries = closedEntries(s, ids);
    const next = closeQuietly(s, ids);
    if (s.windows[windowId]?.incognito) {
      const own = [...keptCleanedTabs(next.privateCleanedTabs[windowId] ?? []), ...entries].slice(-MAX_CLEANED);
      set({ ...next, privateCleanedTabs: { ...next.privateCleanedTabs, [windowId]: own } });
    } else {
      set({ ...next, cleanedTabs: [...keptCleanedTabs(next.cleanedTabs), ...entries].slice(-MAX_CLEANED) });
    }
    return ids.length;
  },

  restoreCleaned(entryId, fromWindowId) {
    const s = get();
    const privateId = fromWindowId && s.windows[fromWindowId]?.incognito
      ? fromWindowId
      : Object.keys(s.privateCleanedTabs).find((id) => !!entryId && s.privateCleanedTabs[id]!.some((c) => c.id === entryId));
    const list = keptCleanedTabs(privateId ? (s.privateCleanedTabs[privateId] ?? []) : s.cleanedTabs);
    const entries = list.filter((c) => !entryId || c.id === entryId);
    if (!entries.length) return;
    const left = list.filter((c) => !entries.includes(c));
    let next: BrowserState = privateId
      ? { ...s, privateCleanedTabs: { ...s.privateCleanedTabs, [privateId]: left } }
      : { ...s, cleanedTabs: left };
    for (const e of entries) {
      const windowId = privateId ? (next.windows[privateId]?.incognito ? privateId : undefined) : restoreTarget(next, e.windowId);
      if (!windowId || (isIncognitoProfile(e.tab.profileId) && e.windowId !== windowId)) continue;
      const [restored, [id]] = restoreSnapshots(next, windowId, [{ tab: e.tab, tabId: e.restoreFrom ?? e.tabId, index: windowId === e.windowId ? e.index : undefined }]);
      next = restored;
      if (id && e.group) next = regroupRestored(next, windowId, [e], [id]);
      if (id && entryId) next = apply(next, activated(next, id));
    }
    set(next);
  },

  clearUnpinnedTabs(windowId) {
    const s = get();
    const ids = unpinnedTabIds(s, windowId);
    if (!ids.length) return null;
    const shown = activeTabId(s, windowId);
    const entries = closedEntries(s, ids);
    get().closeTabs(ids);
    const blankTabId = viewTabIds(get(), windowId).find((id) => !s.tabs[id]) ?? null;
    return { windowId, entries, shownTabId: shown && ids.includes(shown) ? shown : null, blankTabId };
  },

  undoClearTabs({ windowId, entries, shownTabId, blankTabId }) {
    const s = get();
    const target = s.windows[windowId] ? windowId : restoreTarget(s, windowId);
    const back = target ? entries.filter((e) => !isIncognitoProfile(e.tab.profileId) || e.windowId === target) : [];
    if (!target || !back.length) return;
    const cleared = new Set(back.map((e) => e.tabId));
    let next: BrowserState = { ...s, closedTabs: s.closedTabs.filter((c) => !c.tabId || !cleared.has(c.tabId)) };
    const blank = blankTabId ? next.tabs[blankTabId] : undefined;
    const dropBlank = !!blank && blank.windowId === target && !blank.url && !blank.navigation;
    if (dropBlank) {
      const w = next.windows[target]!;
      next = { ...next, windows: { ...next.windows, [target]: { ...w, tabIds: w.tabIds.filter((id) => id !== blankTabId) } } };
    }
    const [restored, ids] = restoreSnapshots(
      next,
      target,
      back.map((e) => ({ tab: e.tab, tabId: e.restoreFrom ?? e.tabId, index: target === e.windowId ? e.index : undefined })),
    );
    next = regroupRestored(restored, target, back, ids);
    const shown = ids[back.findIndex((e) => e.tabId === shownTabId)] ?? (dropBlank && activeTabId(next, target) === blankTabId ? ids[0] : undefined);
    if (shown) next = apply(next, activated(next, shown));
    if (dropBlank) next = removeTabs(next, [blankTabId!], false);
    set(next);
  },

  closeAbandonedNewTabs() {
    const s = get();
    const abandoned = Object.values(s.windows).flatMap((w) => abandonedNewTabs(s, w.id));
    if (abandoned.length) set(removeTabs(s, abandoned, false));
  },
});
