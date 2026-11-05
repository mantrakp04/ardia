import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { activeTabId, inPinnedContainer, isIncognitoProfile, pinSection, viewTabIds, without } from "../browser/model";
import { hasPage } from "../tabs/pageSession";
import { holderOf } from "./pinShare";
import { splitOf, splitTabIds, splitTabIdsOf } from "../splits/splits";
import { lastUsedOf, sharedLastUsed } from "../tabs/tabShare";
import type { ClosedTab, Tab, TabGroup } from "../browser/types";
import { withoutFragment } from "../../lib/url";
import { tileFolderOf } from "./tileFolders";
import { syncGroupOrder, withParent } from "../groups/groups";
import { closedEntries, closeQuietly, keptCleanedTabs, regroupRestored, restoreSnapshots, restoreTarget } from "./closedTabs";
import { activated, apply, removeTabs } from "../tabs/tabs";

export type ClearedTabs = {
  windowId: string;
  entries: ClosedTab[];
  closedEntryIds: string[];
  tabIds: string[];
  groups: TabGroup[];
  fingerprint: string;
  profileId: string;
  remoteDeletions: number;
};

const remotePinDeletions = new Map<string, number>();

export function noteRemotePinDeletion(profileId: string) {
  remotePinDeletions.set(profileId, (remotePinDeletions.get(profileId) ?? 0) + 1);
}

export function unpinnedTabIds(s: BrowserState, windowId: string): string[] {
  return viewTabIds(s, windowId).filter((id) => !inPinnedContainer(s, id));
}

export function isClosedPin(s: BrowserState, id: string): boolean {
  const t = s.tabs[id];
  if (!t || !inPinnedContainer(s, id) || pinSection(t) === "tile") return false;
  return !hasPage(t) && activeTabId(s, t.windowId) !== id && !holderOf(s, id);
}

export function clearedTabIds(s: BrowserState, windowId: string): string[] {
  const ids = unpinnedTabIds(s, windowId);
  const active = activeTabId(s, windowId);
  const kept = new Set(ids.filter((id) => id === active || s.live[id]?.playingAudio));
  for (const id of [...kept]) splitTabIdsOf(splitOf(s, id))?.forEach((pane) => kept.add(pane));
  return ids.filter((id) => !kept.has(id));
}

export const CLEAN_UP_AFTER_MS = 12 * 60 * 60 * 1000;
export const MAX_CLEANED = 100;

function windowFingerprint(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  if (!w) return "";
  const inWindow = (id: string) => s.tabs[id]?.windowId === windowId;
  const tabs = w.tabIds.map((id) => {
    const t = s.tabs[id];
    return t ? [id, t.profileId, pinSection(t), tileFolderOf(t)?.id ?? ""].join(" ") : id;
  });
  const groups = Object.values(s.groups)
    .filter((g) => g.windowId === windowId)
    .map((g) => [g.id, g.parentId ?? "", g.pinned, g.tabIds.join(",")].join(" "))
    .sort();
  const splits = Object.values(s.splits)
    .filter((v) => splitTabIds(v).some(inWindow))
    .map((v) => splitTabIds(v).join(","))
    .sort();
  return [...tabs, "", ...groups, "", ...splits].join("\n");
}

export function undoable(before: BrowserState, after: BrowserState, windowId: string, profileId: string, entries: ClosedTab[]): ClearedTabs {
  return {
    windowId,
    entries,
    closedEntryIds: newClosedEntryIds(before, after),
    tabIds: before.windows[windowId]!.tabIds,
    groups: Object.values(before.groups).filter((g) => g.windowId === windowId),
    fingerprint: windowFingerprint(after, windowId),
    profileId,
    remoteDeletions: remotePinDeletions.get(profileId) ?? 0,
  };
}

export function canUndoClear(s: BrowserState, cleared: ClearedTabs): boolean {
  const closed = new Set(s.closedTabs.map((c) => c.id));
  return (
    (remotePinDeletions.get(cleared.profileId) ?? 0) === cleared.remoteDeletions &&
    cleared.closedEntryIds.every((id) => closed.has(id)) &&
    windowFingerprint(s, cleared.windowId) === cleared.fingerprint
  );
}

function newClosedEntryIds(before: BrowserState, after: BrowserState): string[] {
  return after.closedTabs.filter((c) => !before.closedTabs.includes(c)).map((c) => c.id);
}

const deselectedAt = new Map<string, number>();

export function noteDeselectedTabs(s: BrowserState, ids: readonly string[], at = Date.now()) {
  for (const id of deselectedAt.keys()) if (!s.tabs[id]) deselectedAt.delete(id);
  for (const id of ids) if (s.tabs[id]) deselectedAt.set(id, at);
}

function inactivity(s: BrowserState, windowId: string) {
  const active = activeTabId(s, windowId);
  const grouped = new Set(Object.values(s.groups).flatMap((g) => g.tabIds));
  const inSplit = new Set(Object.values(s.splits).flatMap((v) => splitTabIds(v)));
  const keep = (t: Tab) => t.id === active || inPinnedContainer(s, t.id) || s.live[t.id]?.playingAudio;
  const used = sharedLastUsed(s);
  return {
    active,
    inSplit,
    used,
    keep,
    expires: (t: Tab) => !keep(t) && !grouped.has(t.id) && !inSplit.has(t.id),
    lastUsed: (t: Tab) => Math.max(lastUsedOf(used, t), deselectedAt.get(t.id) ?? 0),
  };
}

export function cleanUpCandidates(s: BrowserState, windowId: string, inactiveForMs = CLEAN_UP_AFTER_MS, now = Date.now()): string[] {
  const view = viewTabIds(s, windowId);
  const { active, inSplit, used, keep, expires, lastUsed } = inactivity(s, windowId);
  const out = new Set<string>();
  const byPage = new Map<string, Tab[]>();
  for (const id of view) {
    const t = s.tabs[id]!;
    if (!t.url) continue;
    const key = withoutFragment(t.url);
    byPage.set(key, [...(byPage.get(key) ?? []), t]);
  }
  for (const same of byPage.values()) {
    if (same.length < 2) continue;
    const keeper = same.find((t) => t.pin) ?? same.find((t) => t.id === active) ?? [...same].sort((a, b) => lastUsedOf(used, b) - lastUsedOf(used, a))[0]!;
    for (const t of same) if (t !== keeper && !keep(t) && !inSplit.has(t.id)) out.add(t.id);
  }
  for (const id of view) {
    const t = s.tabs[id]!;
    if (expires(t) && now - lastUsed(t) >= inactiveForMs) out.add(id);
  }
  return view.filter((id) => out.has(id));
}

export function nextCleanUpAt(s: BrowserState, windowId: string, inactiveForMs: number): number {
  const { expires, lastUsed } = inactivity(s, windowId);
  let next = Infinity;
  for (const id of viewTabIds(s, windowId)) {
    const t = s.tabs[id]!;
    if (expires(t)) next = Math.min(next, lastUsed(t) + inactiveForMs);
  }
  return next;
}

export function abandonedNewTabs(s: BrowserState, windowId: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const selected = new Set(Object.values(w.activeTabIds));
  const shown = w.activeTabIds[w.profileId];
  const out = w.tabIds.filter((id) => {
    const t = s.tabs[id];
    return !!t && t.windowId === w.id && !t.url && !hasPage(t) && !t.pin && id !== shown && !selected.has(id);
  });
  return out.length >= w.tabIds.length ? out.slice(0, w.tabIds.length - 1) : out;
}

export function recentTabIds(s: BrowserState, windowId: string, now = Date.now(), staleAfterMs = CLEAN_UP_AFTER_MS): string[] {
  const view = viewTabIds(s, windowId).map((id) => s.tabs[id]!);
  const sorted = view.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return sorted.filter((t, i) => i < 2 || now - t.lastActiveAt < staleAfterMs).map((t) => t.id);
}


export type CleanUpSlice = {
  cleanedTabs: ClosedTab[];
  privateCleanedTabs: Record<string, ClosedTab[]>;

  cleanUpTabs(windowId: string, options?: { inactiveForMs?: number }): number;
  restoreCleaned(entryId?: string, windowId?: string): void;
  clearUnpinnedTabs(windowId: string): ClearedTabs | null;
  undoClearTabs(cleared: ClearedTabs): void;
  removeClosedPin(id: string): ClearedTabs | null;
  closeAbandonedNewTabs(): void;
};

export function forgetClosedWindowCleanUps(s: BrowserState, prev: BrowserState): Pick<BrowserState, "privateCleanedTabs"> | null {
  if (s.windows === prev.windows) return null;
  const gone = Object.keys(s.privateCleanedTabs).filter((id) => !s.windows[id]);
  return gone.length ? { privateCleanedTabs: without(s.privateCleanedTabs, gone) } : null;
}

export const createCleanUpSlice: StateCreator<BrowserState, [], [], CleanUpSlice> = (set, get) => ({
  cleanedTabs: [],
  privateCleanedTabs: {},

  cleanUpTabs(windowId, options = {}) {
    const s = get();
    const minutes = s.settings.cleanUpInactiveTabsAfterMinutes;
    const ids = cleanUpCandidates(s, windowId, options.inactiveForMs ?? (minutes ? minutes * 60_000 : CLEAN_UP_AFTER_MS));
    if (!ids.length) return 0;
    const entries = closedEntries(s, ids);
    const next = closeQuietly(s, ids);
    if (s.windows[windowId]?.kind === "private") {
      const own = [...keptCleanedTabs(next.privateCleanedTabs[windowId] ?? []), ...entries].slice(-MAX_CLEANED);
      set({ ...next, privateCleanedTabs: { ...next.privateCleanedTabs, [windowId]: own } });
    } else {
      set({ ...next, cleanedTabs: [...keptCleanedTabs(next.cleanedTabs), ...entries].slice(-MAX_CLEANED) });
    }
    return ids.length;
  },

  restoreCleaned(entryId, fromWindowId) {
    const s = get();
    const privateId = fromWindowId && s.windows[fromWindowId]?.kind === "private"
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
      const windowId = privateId ? (next.windows[privateId]?.kind === "private" ? privateId : undefined) : restoreTarget(next, e.windowId);
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
    const ids = clearedTabIds(s, windowId);
    if (!ids.length) return null;
    const entries = closedEntries(s, ids);
    get().closeTabs(ids);
    return undoable(s, get(), windowId, s.windows[windowId]!.profileId, entries);
  },

  undoClearTabs(cleared) {
    const s = get();
    if (!canUndoClear(s, cleared)) return;
    const { windowId, entries } = cleared;
    const undone = new Set(cleared.closedEntryIds);
    const [restored, ids] = restoreSnapshots(
      { ...s, closedTabs: s.closedTabs.filter((c) => !undone.has(c.id)) },
      windowId,
      entries.map((e) => ({ tab: e.tab, tabId: e.restoreFrom ?? e.tabId })),
    );
    const renamed = new Map(entries.map((e, i) => [e.tabId, ids[i]]));
    const now = (id: string) => renamed.get(id) ?? id;
    const back = cleared.tabIds.map(now).filter((id) => restored.tabs[id]?.windowId === windowId);
    const w = restored.windows[windowId]!;
    const window = { ...w, tabIds: [...back, ...w.tabIds.filter((id) => !back.includes(id))] };
    const groups = Object.fromEntries(Object.entries(restored.groups).filter(([, g]) => g.windowId !== windowId));
    for (const g of cleared.groups) {
      const tabIds = g.tabIds.map(now).filter((id) => restored.tabs[id]);
      const current = restored.groups[g.id];
      groups[g.id] = current ? withParent({ ...current, pinned: g.pinned, tabIds }, g.parentId) : { ...g, tabIds };
    }
    const closedTabs = restored.closedTabs.map((c) => {
      const moved = c.tabId ? renamed.get(c.tabId) : undefined;
      return moved ? { ...c, tabId: moved, restoreFrom: c.restoreFrom ?? c.tabId } : c;
    });
    set({ ...restored, closedTabs, groups: syncGroupOrder(groups, window), windows: { ...restored.windows, [windowId]: window } });
  },

  removeClosedPin(id) {
    const s = get();
    if (!isClosedPin(s, id)) return null;
    const windowId = s.tabs[id]!.windowId;
    set(removeTabs(s, [id], true));
    const after = get();
    return undoable(s, after, windowId, s.tabs[id]!.profileId, after.closedTabs.filter((c) => !s.closedTabs.includes(c)));
  },

  closeAbandonedNewTabs() {
    const s = get();
    const abandoned = Object.values(s.windows).flatMap((w) => abandonedNewTabs(s, w.id));
    if (abandoned.length) set(removeTabs(s, abandoned, false));
  },
});
