import {
  isAutoArchiveDue,
  POSITION_STEP,
  positionBetween,
  recencyOrder,
  type AutoArchiveInterval,
  type BrowserTab,
  type TabOrigin,
  type TabPatch,
} from "./tabModels.ts";

export type ClosedTab = { tab: BrowserTab; wasSelected: boolean };

export type TabsData = {
  open: BrowserTab[];
  privates: BrowserTab[];
  selectedId: string | null;
  undo: ClosedTab[][];
  archive: BrowserTab[] | null;
  archivedCount: number;
};

export type TabsChange = {
  data: TabsData;
  put: BrowserTab[];
  remove: string[];
  endedPages: string[];
  clearArchived?: boolean;
};

export type OpenRequest = {
  url: string;
  title?: string;
  origin: TabOrigin;
  isPrivate: boolean;
  after?: string | null;
  selecting?: boolean;
  profileSyncId?: string | null;
};

export const UNDO_LIMIT = 20;

export const emptyTabs = (): TabsData => ({ open: [], privates: [], selectedId: null, undo: [], archive: null, archivedCount: 0 });

export function launchTabs(open: BrowserTab[], archivedCount: number): TabsData {
  const sorted = [...open].sort((a, b) => a.position - b.position);
  const selected = sorted.reduce<BrowserTab | null>((best, tab) => (best === null || tab.lastActive > best.lastActive ? tab : best), null);
  return { ...emptyTabs(), open: sorted, selectedId: selected?.id ?? null, archivedCount };
}

const unchanged = (data: TabsData): TabsChange => ({ data, put: [], remove: [], endedPages: [] });

export const findTab = (data: TabsData, id: string): BrowserTab | undefined =>
  data.open.find((t) => t.id === id) ?? data.privates.find((t) => t.id === id) ?? data.archive?.find((t) => t.id === id);

export const selectedTab = (data: TabsData): BrowserTab | undefined =>
  data.selectedId === null ? undefined : data.open.find((t) => t.id === data.selectedId) ?? data.privates.find((t) => t.id === data.selectedId);

export const deckOrder = (data: TabsData): BrowserTab[] => recencyOrder([...data.open, ...data.privates], data.selectedId);

export const isPrivateTab = (data: TabsData, id: string) => data.privates.some((t) => t.id === id);

function insertSorted(list: readonly BrowserTab[], tab: BrowserTab): BrowserTab[] {
  const rest = list.filter((t) => t.id !== tab.id);
  const index = rest.findIndex((t) => t.position > tab.position);
  rest.splice(index < 0 ? rest.length : index, 0, tab);
  return rest;
}

function renumbered(list: readonly BrowserTab[]): BrowserTab[] {
  return list.map((tab, index) => ({ ...tab, position: index * POSITION_STEP }));
}

function placeAfter(list: readonly BrowserTab[], after: string | null | undefined): { position: number; list: BrowserTab[]; moved: BrowserTab[] } {
  const end = list.length ? list[list.length - 1]!.position + POSITION_STEP : 0;
  const index = after ? list.findIndex((t) => t.id === after) : -1;
  if (index < 0) return { position: end, list: [...list], moved: [] };
  const between = positionBetween(list[index]!.position, list[index + 1]?.position);
  if (between !== null) return { position: between, list: [...list], moved: [] };
  const fresh = renumbered(list);
  return { position: fresh[index]!.position + POSITION_STEP / 2, list: fresh, moved: fresh };
}

function withLastActive(data: TabsData, id: string, now: number): { data: TabsData; put: BrowserTab[] } {
  const openIndex = data.open.findIndex((t) => t.id === id);
  if (openIndex >= 0) {
    const tab = { ...data.open[openIndex]!, lastActive: now };
    const open = [...data.open];
    open[openIndex] = tab;
    return { data: { ...data, open }, put: [tab] };
  }
  const privateIndex = data.privates.findIndex((t) => t.id === id);
  if (privateIndex >= 0) {
    const privates = [...data.privates];
    privates[privateIndex] = { ...privates[privateIndex]!, lastActive: now };
    return { data: { ...data, privates }, put: [] };
  }
  return { data, put: [] };
}

export function selectTab(data: TabsData, id: string | null, now: number): TabsChange {
  let next = data;
  const put: BrowserTab[] = [];
  const current = selectedTab(data);
  if (current && current.id !== id) {
    const touched = withLastActive(next, current.id, now);
    next = touched.data;
    put.push(...touched.put);
  }
  next = { ...next, selectedId: id };
  if (id !== null) {
    const touched = withLastActive(next, id, now);
    next = touched.data;
    put.push(...touched.put);
  }
  return { data: next, put: dedupe(put), remove: [], endedPages: [] };
}

function dedupe(tabs: BrowserTab[]): BrowserTab[] {
  const byId = new Map<string, BrowserTab>();
  for (const tab of tabs) byId.set(tab.id, tab);
  return [...byId.values()];
}

export function openTab(data: TabsData, request: OpenRequest, now: number, id: string): { change: TabsChange; tab: BrowserTab } {
  const opener = request.after ? findTab(data, request.after) : undefined;
  const afterPrivate = Boolean(request.after && isPrivateTab(data, request.after));
  const base: BrowserTab = {
    id,
    url: request.url,
    title: request.title ?? "",
    created: now,
    lastActive: now,
    archivedAt: null,
    position: 0,
    profileSyncId: opener && !opener.isPrivate ? opener.profileSyncId : request.profileSyncId ?? null,
    faviconUrl: null,
    themeColorHex: null,
    snapshotFileName: null,
    origin: request.origin,
    receivedKey: null,
    receivedFromDevice: null,
    isPrivate: false,
  };
  const selecting = request.selecting ?? true;
  if (request.isPrivate || afterPrivate) {
    const placed = placeAfter(data.privates, request.after);
    const tab = { ...base, isPrivate: true, profileSyncId: null, position: placed.position };
    const next = { ...data, privates: insertSorted(placed.list, tab) };
    const change = selecting ? selectTab(next, tab.id, now) : unchanged(next);
    return { change: { ...change, put: change.put.filter((t) => !t.isPrivate) }, tab };
  }
  const placed = placeAfter(data.open, request.after);
  const tab = { ...base, position: placed.position };
  const next = { ...data, open: insertSorted(placed.list, tab) };
  const change = selecting ? selectTab(next, tab.id, now) : unchanged(next);
  return { change: { ...change, put: dedupe([...placed.moved, tab, ...change.put]) }, tab };
}

export function archiveTabs(data: TabsData, ids: readonly string[], undoable: boolean, now: number): TabsChange {
  const set = new Set(ids);
  const closing = data.open.filter((t) => set.has(t.id));
  if (!closing.length) return unchanged(data);
  const undo = undoable ? [...data.undo, closing.map((tab) => ({ tab, wasSelected: tab.id === data.selectedId }))].slice(-UNDO_LIMIT) : data.undo;
  const selectedIndex = data.open.findIndex((t) => t.id === data.selectedId);
  const open = data.open.filter((t) => !set.has(t.id));
  const archived = closing.map((tab) => ({ ...tab, archivedAt: now }));
  const archive = data.archive ? [...archived, ...data.archive].sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)) : null;
  let next: TabsData = { ...data, open, undo, archive, archivedCount: data.archivedCount + archived.length };
  const put: BrowserTab[] = [...archived];
  if (data.selectedId !== null && set.has(data.selectedId)) {
    const neighbour = selectedIndex >= 0 ? Math.min(selectedIndex, open.length - 1) : -1;
    next = { ...next, selectedId: neighbour >= 0 ? open[neighbour]!.id : null };
    if (neighbour >= 0) {
      const touched = withLastActive(next, open[neighbour]!.id, now);
      next = touched.data;
      put.push(...touched.put);
    }
  }
  return { data: next, put, remove: [], endedPages: closing.map((t) => t.id) };
}

export function closePrivateTabs(data: TabsData, ids: readonly string[]): TabsChange {
  const set = new Set(ids);
  if (!data.privates.some((t) => set.has(t.id))) return unchanged(data);
  const selectedIndex = data.privates.findIndex((t) => t.id === data.selectedId);
  const privates = data.privates.filter((t) => !set.has(t.id));
  let selectedId = data.selectedId;
  if (selectedId !== null && set.has(selectedId)) {
    if (selectedIndex >= 0 && privates.length) {
      selectedId = privates[Math.min(selectedIndex, privates.length - 1)]!.id;
    } else {
      selectedId = data.open.reduce<BrowserTab | null>((best, t) => (best === null || t.lastActive > best.lastActive ? t : best), null)?.id ?? null;
    }
  }
  const ended = data.privates.filter((t) => set.has(t.id)).map((t) => t.id);
  return { data: { ...data, privates, selectedId }, put: [], remove: [], endedPages: ended };
}

export function closeTab(data: TabsData, id: string, now: number): TabsChange {
  return isPrivateTab(data, id) ? closePrivateTabs(data, [id]) : archiveTabs(data, [id], true, now);
}

export const closeAllPrivateTabs = (data: TabsData): TabsChange => closePrivateTabs(data, data.privates.map((t) => t.id));

export function closeAllTabs(data: TabsData, now: number): TabsChange {
  const privates = closeAllPrivateTabs(data);
  const archived = archiveTabs(privates.data, privates.data.open.map((t) => t.id), true, now);
  return { ...archived, endedPages: [...privates.endedPages, ...archived.endedPages] };
}

function unarchive(data: TabsData, restored: BrowserTab[]): TabsData {
  const ids = new Set(restored.map((t) => t.id));
  const known = data.archive?.filter((t) => ids.has(t.id)).length ?? restored.length;
  return {
    ...data,
    archive: data.archive ? data.archive.filter((t) => !ids.has(t.id)) : null,
    archivedCount: Math.max(0, data.archivedCount - Math.max(known, restored.length)),
  };
}

export function reopenLastClosed(data: TabsData, now: number): { change: TabsChange; reopened: BrowserTab[] } {
  const group = data.undo[data.undo.length - 1];
  if (!group) return { change: unchanged(data), reopened: [] };
  let next: TabsData = { ...data, undo: data.undo.slice(0, -1) };
  const reopened: BrowserTab[] = [];
  let selection: string | null = null;
  for (const closed of group) {
    if (next.open.some((t) => t.id === closed.tab.id)) continue;
    const current = data.archive?.find((t) => t.id === closed.tab.id) ?? closed.tab;
    const clash = next.open.some((t) => t.position === closed.tab.position);
    const end = next.open.length ? next.open[next.open.length - 1]!.position + POSITION_STEP : 0;
    const tab = { ...current, archivedAt: null, lastActive: now, position: clash ? end : closed.tab.position };
    next = { ...unarchive(next, [tab]), open: insertSorted(next.open, tab) };
    reopened.push(tab);
    if (closed.wasSelected) selection = tab.id;
  }
  const target = selection ?? reopened[reopened.length - 1]?.id ?? null;
  const selected = target ? selectTab(next, target, now) : unchanged(next);
  const fresh = reopened.map((t) => selected.data.open.find((o) => o.id === t.id) ?? t);
  return { change: { ...selected, put: dedupe([...fresh, ...selected.put]) }, reopened: fresh };
}

export function restoreArchived(data: TabsData, archived: BrowserTab, now: number): TabsChange {
  if (archived.archivedAt === null || data.open.some((t) => t.id === archived.id)) return unchanged(data);
  const end = data.open.length ? data.open[data.open.length - 1]!.position + POSITION_STEP : 0;
  const tab = { ...archived, archivedAt: null, position: end, lastActive: now };
  const next = { ...unarchive(data, [tab]), open: insertSorted(data.open, tab) };
  const selected = selectTab(next, tab.id, now);
  return { ...selected, put: dedupe([tab, ...selected.put]) };
}

export function updateTab(data: TabsData, id: string, patch: TabPatch): TabsChange {
  const tab = findTab(data, id);
  if (!tab) return unchanged(data);
  const next: BrowserTab = { ...tab };
  let changed = false;
  for (const key of Object.keys(patch) as (keyof TabPatch)[]) {
    const value = patch[key];
    if (value === undefined || value === null || value === tab[key]) continue;
    next[key] = value;
    changed = true;
  }
  if (!changed) return unchanged(data);
  const swap = (list: BrowserTab[]) => list.map((t) => (t.id === id ? next : t));
  const updated: TabsData = {
    ...data,
    open: swap(data.open),
    privates: swap(data.privates),
    archive: data.archive ? swap(data.archive) : null,
  };
  return { data: updated, put: next.isPrivate ? [] : [next], remove: [], endedPages: [] };
}

export function runAutoArchive(data: TabsData, interval: AutoArchiveInterval, now: number): TabsChange {
  const due = data.open.filter((t) => isAutoArchiveDue(t.lastActive, now, interval, t.id === data.selectedId));
  return due.length ? archiveTabs(data, due.map((t) => t.id), false, now) : unchanged(data);
}

export function withArchive(data: TabsData, rows: readonly BrowserTab[]): TabsData {
  const openIds = new Set([...data.open, ...data.privates].map((t) => t.id));
  const merged = new Map<string, BrowserTab>();
  for (const tab of [...(data.archive ?? []), ...rows]) {
    if (tab.archivedAt !== null && !openIds.has(tab.id) && !merged.has(tab.id)) merged.set(tab.id, tab);
  }
  const archive = [...merged.values()].sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  return { ...data, archive };
}

export function deleteArchived(data: TabsData, ids: readonly string[]): TabsChange {
  const set = new Set(ids);
  if (!set.size) return unchanged(data);
  const removed = data.archive?.filter((t) => set.has(t.id)).length ?? set.size;
  return {
    data: {
      ...data,
      archive: data.archive?.filter((t) => !set.has(t.id)) ?? null,
      undo: data.undo.map((group) => group.filter((c) => !set.has(c.tab.id))).filter((group) => group.length > 0),
      archivedCount: Math.max(0, data.archivedCount - removed),
    },
    put: [],
    remove: [...set],
    endedPages: [],
  };
}

export function clearArchive(data: TabsData): TabsChange {
  const openIds = new Set(data.open.map((t) => t.id));
  return {
    data: {
      ...data,
      archive: data.archive ? [] : null,
      archivedCount: 0,
      undo: data.undo.map((group) => group.filter((c) => openIds.has(c.tab.id))).filter((group) => group.length > 0),
    },
    put: [],
    remove: [],
    endedPages: [],
    clearArchived: true,
  };
}

export type ArchivedDay = { day: string; tabs: BrowserTab[] };

export function archiveDays(archive: readonly BrowserTab[], dayOf: (time: number) => string): ArchivedDay[] {
  const days: ArchivedDay[] = [];
  for (const tab of archive) {
    const day = dayOf(tab.archivedAt ?? tab.lastActive);
    const last = days[days.length - 1];
    if (last && last.day === day) last.tabs.push(tab);
    else days.push({ day, tabs: [tab] });
  }
  return days;
}
