import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { nestGroups, syncGroupOrder, withGroupsPlaced, withParent } from "../groups/groups";
import { activeTabId, bookmarkProfileId, inPinnedContainer, isIncognitoProfile, snapshotTab, viewTabIds, without } from "../browser/model";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import { clickedSelection, dropping, type ClickMods, type Drop } from "../drag/drops";
import type { ClosedGroup, ClosedTab, Tab, TabGroup } from "../browser/types";
import { hostOf } from "../../lib/url";
import type { PinChoices, PinSync } from "./pinChoices";
import { groupLabel, groupOf, movingGroup, withGroup, withRowsGrouped, type GroupPlacement } from "./tabGrouping";
import { groupingOnto, placing, type TabPlacement } from "./placing";
import { closedEntries, closeQuietly, closingGroup, keptCleanedTabs, nestedSnapshot, rebuildNested, regroupRestored, restoreSnapshots, restoreTarget } from "./closedTabs";
import { abandonedNewTabs, canUndoClear, CLEAN_UP_AFTER_MS, cleanUpCandidates, clearedTabIds, isClosedPin, MAX_CLEANED, undoable, type ClearedTabs } from "./tabCleanup";

export { groupChoiceKey, livePinTable, nextPinChoice, notePinChoices, orderChoiceKey, placeChoiceKey, type PinChoices, type PinSync, type PinSyncEntry } from "./pinChoices";
export { canMoveGroup, groupLabel, groupOf, groupWithOpener, movingGroup, pinnedChildGroup, withGroup, withRowsGrouped, type GroupPlacement } from "./tabGrouping";
export { groupingOnto, placing, type TabPlacement } from "./placing";
export { cleanedTabsFor, closingGroup, keptCleanedTabs, keptDeletedGroups, nestedSnapshot, rebuildNested, restoreSnapshots, restoringGroup } from "./closedTabs";
export { canUndoClear, cleanUpCandidates, clearedTabIds, isClosedPin, noteRemotePinDeletion, recentTabIds, unpinnedTabIds, type ClearedTabs } from "./tabCleanup";

export type OrganizeSlice = {
  selection: Record<string, string[]>;
  selectionAnchors: Record<string, string>;
  pinChoices: PinChoices;
  pinSync: PinSync;
  cleanedTabs: ClosedTab[];
  privateCleanedTabs: Record<string, ClosedTab[]>;
  privateSiteMutes: Record<string, Record<string, boolean>>;
  closedGroups: ClosedGroup[];
  deletedGroups: ClosedGroup[];

  setSelection(windowId: string, ids: string[]): void;
  clickTab(windowId: string, tabId: string, mods?: ClickMods): void;
  placeTabs(ids: string[], placement: TabPlacement): void;
  dropTabs(ids: string[], drop: Drop): boolean;
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
  removeClosedPin(id: string): ClearedTabs | null;
  closeAbandonedNewTabs(): void;
};

export function selectedTabIds(s: BrowserState, windowId: string): string[] {
  const view = viewTabIds(s, windowId);
  const selected = (s.selection[windowId] ?? []).filter((id) => view.includes(id));
  if (selected.length) return view.filter((id) => selected.includes(id));
  const active = activeTabId(s, windowId);
  return active ? [active] : [];
}

export function samePage(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
  return norm(a) === norm(b);
}

export const awayFromPin = (t: Pick<Tab, "url" | "pinnedUrl">) => !!t.pinnedUrl && !!t.url && !samePage(t.url, t.pinnedUrl);

function isSiteMuted(s: Pick<BrowserState, "settings" | "privateSiteMutes">, tab: Pick<Tab, "windowId" | "profileId">, host: string): boolean {
  const own = isIncognitoProfile(tab.profileId) ? s.privateSiteMutes[tab.windowId]?.[host] : undefined;
  return own ?? (s.settings.mutedSites ?? []).includes(host);
}

export function onUrlChange(s: BrowserState, tab: Tab, url: string): Partial<Tab> {
  const patch: Partial<Tab> = {};
  const before = hostOf(tab.url);
  const after = hostOf(url);
  if (before !== after) {
    if (isSiteMuted(s, tab, after)) patch.muted = true;
    else if (isSiteMuted(s, tab, before)) patch.muted = false;
  }
  if (!tab.pinnedUrl && url && inPinnedContainer(s, tab.id)) patch.pinnedUrl = url;
  return patch;
}

export function pruneSelection(selection: Record<string, string[]>, gone: Set<string>): Record<string, string[]> {
  if (!Object.values(selection).some((ids) => ids.some((id) => gone.has(id)))) return selection;
  return Object.fromEntries(Object.entries(selection).map(([w, ids]) => [w, ids.filter((id) => !gone.has(id))]));
}

function openInActiveGroup(s: BrowserState, windowId: string, tabId: string) {
  const active = activeTabId(s, windowId);
  if (!active || active === tabId || s.tabs[tabId]?.pinned || s.tabs[active]?.pinned) return;
  const group = groupOf(s, active);
  if (group) s.addTabsToGroup(group.id, [tabId]);
  else s.groupTabs([active, tabId]);
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
  selectionAnchors: {},
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

  clickTab(windowId, tabId, mods = {}) {
    const s = get();
    const intoGroup = !!mods.altKey && !!mods.shiftKey && !mods.metaKey && s.settings.optShiftClickOpensInGroup;
    const picked = intoGroup ? null : clickedSelection(s, windowId, tabId, mods);
    if (intoGroup) openInActiveGroup(s, windowId, tabId);
    const anchor = picked ? picked.anchor : tabId;
    if (anchor && anchor !== get().selectionAnchors[windowId]) set({ selectionAnchors: { ...get().selectionAnchors, [windowId]: anchor } });
    get().setSelection(windowId, picked?.selection ?? []);
    if (!picked) get().activate(tabId);
  },

  placeTabs(ids, placement) {
    set((s) => placing(s, ids, placement));
  },

  dropTabs(ids, drop) {
    const s = get();
    const next = dropping(s, ids, drop);
    if (next === s) return false;
    set(next);
    return true;
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
    if (!t || !next || !inPinnedContainer(get(), tabId)) return;
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
    const [next, id] = groupingOnto(get(), ids, targetId);
    if (id) set(next);
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
    const minutes = s.settings.cleanUpInactiveTabsAfterMinutes;
    const ids = cleanUpCandidates(s, windowId, options.inactiveForMs ?? (minutes ? minutes * 60_000 : CLEAN_UP_AFTER_MS));
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
