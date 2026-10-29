import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { innermostGroupOf, leaveGroups, syncGroupOrder } from "../groups/groups";
import { inPinnedContainer, isPinnedRow, newId, tabLayoutOf } from "../browser/model";
import { placing } from "../pins/placing";
import { choose } from "../settings/settings";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import type { AdoptId, BrowserWindow, SplitSlot, SplitView, Tab } from "../browser/types";

export type SplitsSlice = {
  splits: Record<string, SplitView>;

  createSplit(tabIds: string[], orientation?: SplitView["orientation"]): string;
  openSplitPane(windowId: string, options?: OpenPaneOptions): OpenPaneResult;
  replaceSplitPane(paneTabId: string, tabId: string): void;
  removeTabFromSplit(tabId: string): void;
  separateSplit(splitId: string): void;
  updateSplit(id: string, patch: { sizes?: number[]; stackSizes?: [number, number] }): void;
  flipSplit(splitId: string): void;
  toggleSplitOrientation(splitId: string): void;
  movePane(tabId: string, delta: 1 | -1): void;
  focusPane(windowId: string, delta: 1 | -1): void;
  toggleTabLayout(windowId: string): void;
};

export type SplitSide = "left" | "right" | "top" | "bottom";
export type OpenPaneOptions = {
  tabId?: string;
  url?: string;
  anchorTabId?: string;
  side?: SplitSide;
  background?: boolean;
  adoptId?: AdoptId;
  inPlaceOf?: string;
};
export type OpenPaneResult = { ok: true; tabId: string; splitId: string } | { ok: false; reason: "max" | "invalid" };

export const MAX_SPLIT_PANES = 3;

const flatIds = new WeakMap<SplitSlot[], string[]>();

export const slotTabIds = (slot: SplitSlot): string[] => ("stack" in slot ? slot.stack : [slot.tabId]);

export function splitTabIds(split: Pick<SplitView, "slots">): string[] {
  let ids = flatIds.get(split.slots);
  if (!ids) flatIds.set(split.slots, (ids = split.slots.flatMap(slotTabIds)));
  return ids;
}

export const splitTabIdsOf = (split: Pick<SplitView, "slots"> | undefined): string[] | undefined => (split ? splitTabIds(split) : undefined);

export const isStacked = (split: Pick<SplitView, "slots">, tabId: string) => split.slots.some((slot) => "stack" in slot && slot.stack.includes(tabId));

export const evenSlots = (ids: string[]): SplitSlot[] => ids.map((tabId) => ({ size: 1 / ids.length, tabId }));

const evened = (slots: SplitSlot[]): SplitSlot[] => slots.map((slot) => ({ ...slot, size: 1 / slots.length }));

export const mapSlotIds = (slots: SplitSlot[], f: (id: string) => string): SplitSlot[] =>
  slots.map((slot) => ("stack" in slot ? { ...slot, stack: [f(slot.stack[0]), f(slot.stack[1])] } : { ...slot, tabId: f(slot.tabId) }));

export function stackAt(split: Pick<SplitView, "slots">): number {
  let at = 0;
  for (const slot of split.slots) {
    if ("stack" in slot) return at;
    at += 1;
  }
  return -1;
}

export function withPaneIds(split: SplitView, ids: string[]): SplitView {
  let i = 0;
  const slots = split.slots.map((slot): SplitSlot => ("stack" in slot ? { ...slot, stack: [ids[i++]!, ids[i++]!] } : { ...slot, tabId: ids[i++]! }));
  return { ...split, slots };
}

export function splitOf(s: Pick<BrowserState, "splits">, tabId: string | undefined): SplitView | undefined {
  if (!tabId) return undefined;
  for (const v of Object.values(s.splits)) if (splitTabIds(v).includes(tabId)) return v;
  return undefined;
}

export function splitRowPanes(s: Pick<BrowserState, "tabs">, split: SplitView | undefined): string[] {
  if (!split) return [];
  const unpinned = splitTabIds(split).filter((id) => s.tabs[id] && !s.tabs[id]!.pin);
  if (unpinned.length >= 2) return unpinned;
  const rows = splitTabIds(split).filter((id) => isPinnedRow(s.tabs[id]));
  return rows.length >= 2 ? rows : [];
}

export function withSplitRows(s: Pick<BrowserState, "tabs" | "splits">, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const panes = splitRowPanes(s, splitOf(s, id));
    if (panes.includes(id)) panes.forEach((pane) => out.add(pane));
  }
  return out.size === ids.length ? ids : [...out];
}

export function withPinnedPanes(s: Pick<BrowserState, "tabs" | "groups" | "splits">, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) for (const pane of splitTabIdsOf(splitOf(s, id)) ?? []) if (inPinnedContainer(s, pane)) out.add(pane);
  return out.size === ids.length ? ids : [...out];
}

export function splitRowHead(s: Pick<BrowserState, "tabs" | "splits">, order: string[], id: string): string {
  const panes = splitRowPanes(s, splitOf(s, id));
  return panes.includes(id) ? (order.find((x) => panes.includes(x)) ?? id) : id;
}

export function removeFromSplits(splits: Record<string, SplitView>, gone: Set<string>): Record<string, SplitView> {
  if (!Object.values(splits).some((v) => splitTabIds(v).some((id) => gone.has(id)))) return splits;
  const next: Record<string, SplitView> = {};
  for (const v of Object.values(splits)) {
    if (!splitTabIds(v).some((id) => gone.has(id))) {
      next[v.id] = v;
      continue;
    }
    const slots = v.slots.flatMap((slot): SplitSlot[] => {
      if (!("stack" in slot)) return gone.has(slot.tabId) ? [] : [slot];
      const left = slot.stack.filter((id) => !gone.has(id));
      return left.length === 2 ? [slot] : left.length === 1 ? [{ size: slot.size, tabId: left[0]! }] : [];
    });
    if (slots.flatMap(slotTabIds).length < 2) continue;
    const total = slots.reduce((sum, slot) => sum + slot.size, 0);
    next[v.id] = { ...v, slots: total > 0 ? slots.map((slot) => ({ ...slot, size: slot.size / total })) : evened(slots) };
  }
  return next;
}

export function sanitizeSplits(splits: Record<string, SplitView>, tabs: Record<string, Tab>): Record<string, SplitView> {
  const next: Record<string, SplitView> = {};
  const used = new Set<string>();
  for (const v of Object.values(splits)) {
    const first = tabs[splitTabIds(v)[0] ?? ""];
    const ok = (id: string) => tabs[id]?.windowId === v.windowId && tabs[id]?.profileId === first?.profileId && !used.has(id);
    const gone = new Set(splitTabIds(v).filter((id) => !ok(id)));
    const fixed = gone.size ? removeFromSplits({ [v.id]: v }, gone)[v.id] : v;
    if (!fixed || splitTabIds(fixed).length > MAX_SPLIT_PANES) continue;
    splitTabIds(fixed).forEach((id) => used.add(id));
    next[v.id] = fixed;
  }
  return next;
}

function gatherPinned(s: BrowserState, anchorId: string, members: string[]): BrowserState {
  const newcomers = members.filter((id) => id !== anchorId && s.tabs[id] && !isPinnedRow(s.tabs[id]));
  const settled = (splitTabIdsOf(splitOf(s, anchorId)) ?? []).filter((id) => !newcomers.includes(id) && isPinnedRow(s.tabs[id]));
  if (!newcomers.length || settled.length < 2) return s;
  const next = placing(s, newcomers, { pinned: true, row: true, beforeId: anchorId });
  const w = next.windows[s.tabs[anchorId]!.windowId]!;
  const block = members.filter((id) => id === anchorId || newcomers.includes(id));
  const tabIds = w.tabIds.filter((id) => !newcomers.includes(id));
  tabIds.splice(tabIds.indexOf(anchorId), 1, ...block);
  return { ...next, windows: { ...next.windows, [w.id]: { ...w, tabIds } } };
}

function gather(s: BrowserState, anchorId: string, members: string[]): BrowserState {
  const anchor = s.tabs[anchorId];
  const w = anchor && s.windows[anchor.windowId];
  if (!anchor || !w) return s;
  if (anchor.pin) return isPinnedRow(anchor) ? gatherPinned(s, anchorId, members) : s;
  const moving = new Set(members.filter((id) => id !== anchorId && s.tabs[id] && !s.tabs[id]!.pin));
  if (!moving.size) return s;
  const block = members.filter((id) => id === anchorId || moving.has(id));
  const tabIds = w.tabIds.filter((id) => !moving.has(id));
  tabIds.splice(tabIds.indexOf(anchorId), 1, ...block);
  const window: BrowserWindow = { ...w, tabIds };
  let groups = leaveGroups(s.groups, moving);
  const group = innermostGroupOf(s.groups, anchorId);
  if (group && groups[group.id]) groups = { ...groups, [group.id]: { ...groups[group.id]!, tabIds: [...groups[group.id]!.tabIds, ...moving] } };
  return { ...s, windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(groups, window) };
}

function placedAfterSplit(s: BrowserState, split: SplitView, tabId: string): BrowserState {
  const w = s.windows[split.windowId];
  if (!w || s.tabs[tabId]?.pin) return s;
  const tabIds = w.tabIds.filter((id) => id !== tabId);
  const last = Math.max(...splitTabIds(split).map((id) => tabIds.indexOf(id)));
  tabIds.splice(last + 1, 0, tabId);
  const window: BrowserWindow = { ...w, tabIds };
  return { ...s, windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(s.groups, window) };
}

function withPane(existing: SplitView | undefined, anchorId: string, tabId: string, side: SplitSide, windowId: string): SplitView | null {
  const horizontal = side === "left" || side === "right";
  const before = side === "left" || side === "top";
  if (!existing) {
    return { id: newId("split"), windowId, orientation: horizontal ? "horizontal" : "vertical", slots: evenSlots(before ? [tabId, anchorId] : [anchorId, tabId]) };
  }
  if (splitTabIds(existing).length >= MAX_SPLIT_PANES) return null;
  const slots = [...existing.slots];
  const k = slots.findIndex((slot) => slotTabIds(slot).includes(anchorId));
  if (k < 0) return null;
  if ((existing.orientation === "horizontal") === horizontal) {
    slots.splice(before ? k : k + 1, 0, { size: 0, tabId });
    return { ...existing, slots: evened(slots) };
  }
  slots[k] = { size: slots[k]!.size, stack: before ? [tabId, anchorId] : [anchorId, tabId], stackSizes: [0.5, 0.5] };
  return { ...existing, slots };
}

export const createSplitsSlice: StateCreator<BrowserState, [], [], SplitsSlice> = (set, get) => ({
  splits: {},

  createSplit(tabIds, orientation = "horizontal") {
    const s = get();
    const tabs = [...new Set(tabIds)].map((id) => s.tabs[id]).filter((t): t is Tab => !!t);
    const first = tabs[0];
    if (tabs.length < 2 || tabs.length > MAX_SPLIT_PANES || !first) return "";
    if (tabs.some((t) => t.windowId !== first.windowId || t.profileId !== first.profileId)) return "";
    const ids = tabs.map((t) => t.id);
    const splits = removeFromSplits(s.splits, new Set(ids));
    const split: SplitView = { id: newId("split"), windowId: first.windowId, orientation, slots: evenSlots(ids) };
    set(gather({ ...s, splits: { ...splits, [split.id]: split } }, first.id, ids));
    return split.id;
  },

  openSplitPane(windowId, o = {}) {
    let s = get();
    const w = s.windows[windowId];
    const anchorId = o.anchorTabId ?? (w ? w.activeTabIds[w.profileId] : undefined);
    const anchor = anchorId ? s.tabs[anchorId] : undefined;
    if (!w || !anchor || anchor.windowId !== windowId) return { ok: false, reason: "invalid" };
    const existing = splitOf(s, anchor.id);
    const replaced = o.inPlaceOf && o.inPlaceOf !== anchor.id && existing && splitTabIds(existing).includes(o.inPlaceOf) ? o.inPlaceOf : undefined;
    if (existing && splitTabIds(existing).length >= MAX_SPLIT_PANES && !replaced) return { ok: false, reason: "max" };

    let tabId = o.tabId;
    if (tabId) {
      const t = s.tabs[tabId];
      if (!t || tabId === anchor.id || t.windowId !== windowId || t.profileId !== anchor.profileId) return { ok: false, reason: "invalid" };
      s = { ...s, splits: removeFromSplits(s.splits, new Set([tabId])) };
    } else {
      [s, tabId] = withNewTab(s, windowId, { url: o.url, adoptId: o.url ? o.adoptId : undefined, profileId: anchor.profileId, openerId: o.url ? anchor.id : undefined, background: true });
    }
    const current = existing && s.splits[existing.id];
    if (replaced && current) {
      const split = withPaneIds(current, splitTabIds(current).map((id) => (id === replaced ? tabId : id)));
      s = gather(s, anchor.id, splitTabIds(split));
      s = placedAfterSplit({ ...s, splits: { ...s.splits, [split.id]: split } }, split, replaced);
      if (!o.background) s = apply(s, activated(s, tabId));
      set(s);
      return { ok: true, tabId, splitId: split.id };
    }
    const split = withPane(current, anchor.id, tabId, o.side ?? "right", windowId);
    if (!split) return { ok: false, reason: "max" };
    s = gather({ ...s, splits: { ...s.splits, [split.id]: split } }, anchor.id, splitTabIds(split));
    if (!o.background) s = apply(s, activated(s, tabId));
    set(s);
    return { ok: true, tabId, splitId: split.id };
  },

  replaceSplitPane(paneTabId, tabId) {
    let s = get();
    const split = splitOf(s, paneTabId);
    const pane = s.tabs[paneTabId];
    const tab = s.tabs[tabId];
    if (!split || !pane || !tab || splitTabIds(split).includes(tabId) || tab.windowId !== pane.windowId || tab.profileId !== pane.profileId) return;
    s = { ...s, splits: removeFromSplits(s.splits, new Set([tabId])) };
    s = gather(s, paneTabId, [paneTabId, tabId]);
    const current = s.splits[split.id]!;
    s = { ...s, splits: { ...s.splits, [split.id]: withPaneIds(current, splitTabIds(current).map((id) => (id === paneTabId ? tabId : id))) } };
    s = removeTabs(s, [paneTabId], false);
    set(apply(s, activated(s, tabId)));
  },

  removeTabFromSplit(tabId) {
    set((s) => {
      const split = splitOf(s, tabId);
      if (!split) return {};
      const splits = removeFromSplits(s.splits, new Set([tabId]));
      if (!splits[split.id]) return { splits };
      const w = s.windows[split.windowId]!;
      const rest = splitTabIds(split).filter((id) => id !== tabId);
      const tabIds = w.tabIds.filter((id) => id !== tabId);
      const last = Math.max(...rest.map((id) => tabIds.indexOf(id)));
      tabIds.splice(last + 1, 0, tabId);
      const window = s.tabs[tabId]?.pin ? w : { ...w, tabIds };
      return { splits, windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(s.groups, window) };
    });
  },

  separateSplit(splitId) {
    set((s) => {
      const { [splitId]: _, ...splits } = s.splits;
      return { splits };
    });
  },

  updateSplit(id, { sizes, stackSizes }) {
    set((s) => {
      const split = s.splits[id];
      if (!split) return {};
      const slots = split.slots.map((slot, i): SplitSlot => {
        const size = sizes && sizes.length === split.slots.length ? sizes[i]! : slot.size;
        return "stack" in slot ? { ...slot, size, ...(stackSizes ? { stackSizes } : {}) } : { ...slot, size };
      });
      return { splits: { ...s.splits, [id]: { ...split, slots } } };
    });
  },

  flipSplit(splitId) {
    set((s) => {
      const split = s.splits[splitId];
      if (!split) return {};
      return { splits: { ...s.splits, [splitId]: { ...split, slots: [...split.slots].reverse() } } };
    });
  },

  toggleSplitOrientation(splitId) {
    set((s) => {
      const split = s.splits[splitId];
      if (!split) return {};
      const orientation = split.orientation === "horizontal" ? "vertical" : "horizontal";
      return { splits: { ...s.splits, [splitId]: { ...split, orientation } } };
    });
  },

  movePane(tabId, delta) {
    set((s) => {
      const split = splitOf(s, tabId);
      if (!split) return {};
      const tabIds = [...splitTabIds(split)];
      const i = tabIds.indexOf(tabId);
      const j = i + delta;
      if (j < 0 || j >= tabIds.length) return {};
      [tabIds[i], tabIds[j]] = [tabIds[j]!, tabIds[i]!];
      return { splits: { ...s.splits, [split.id]: withPaneIds(split, tabIds) } };
    });
  },

  focusPane(windowId, delta) {
    const s = get();
    const w = s.windows[windowId];
    const active = w?.activeTabIds[w.profileId];
    const split = splitOf(s, active);
    if (!split || !active) return;
    const panes = splitTabIds(split);
    const i = panes.indexOf(active);
    get().activate(panes[(i + delta + panes.length) % panes.length]!);
  },

  toggleTabLayout(windowId) {
    set((s) => {
      const w = s.windows[windowId];
      if (!w) return {};
      const tabLayout = tabLayoutOf(s, windowId) === "sidebar" ? "top" : "sidebar";
      return { windows: { ...s.windows, [windowId]: { ...w, tabLayout } }, ...choose(s, { tabLayout }) };
    });
  },
});
