import type { BrowserState } from "./browser";
import { changedIds } from "./changes";
import { inPinnedContainer, isIncognitoProfile, wake } from "./model";
import { mirrored, pinKeyOf } from "./pinMirror";
import { splitOf } from "./splits";
import { sharedListTab } from "./tabShare";
import type { BrowserWindow, Tab, TabGroup, TabLive } from "./types";

const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;

export const shareKeyOf = (t: Pick<Tab, "profileId" | "id" | "pinKey">) => `${t.profileId}\u0001${pinKeyOf(t)}`;

function shares(s: BrowserState, t: Tab | undefined): t is Tab {
  return !!t && !isIncognitoProfile(t.profileId) && mirrored(s.windows[t.windowId]) && (inPinnedContainer(s, t.id) || sharedListTab(s, t)) && !splitOf(s, t.id);
}

function holds(s: BrowserState, holder: Tab | undefined, copy: Tab): holder is Tab {
  return (
    shares(s, holder) &&
    holder.id !== copy.id &&
    holder.windowId !== copy.windowId &&
    holder.profileId === copy.profileId &&
    pinKeyOf(holder) === pinKeyOf(copy) &&
    hasPage(holder) &&
    !holder.pageIn
  );
}

export function holderOf(s: BrowserState, id: string): Tab | undefined {
  const t = s.tabs[id];
  if (!shares(s, t) || hasPage(t)) return undefined;
  if (t.pageIn) {
    const named = s.tabs[t.pageIn];
    if (holds(s, named, t)) return named;
  }
  const key = pinKeyOf(t);
  let best: Tab | undefined;
  for (const x of Object.values(s.tabs)) {
    if (pinKeyOf(x) !== key || !holds(s, x, t)) continue;
    if (!best || x.lastActiveAt > best.lastActiveAt) best = x;
  }
  return best;
}

const swapIds = (ids: string[], a: string, b: string) => {
  if (!ids.includes(a) && !ids.includes(b)) return ids;
  return ids.map((x) => (x === a ? b : x === b ? a : x));
};

function swapWindow(w: BrowserWindow, a: string, b: string): BrowserWindow {
  const active = Object.entries(w.activeTabIds);
  const touched = active.some(([, id]) => id === a || id === b);
  return {
    ...w,
    tabIds: swapIds(w.tabIds, a, b),
    ...(touched ? { activeTabIds: Object.fromEntries(active.map(([p, id]) => [p, id === a ? b : id === b ? a : id])) } : {}),
  };
}

function shownFields(t: Tab): Pick<Tab, "url" | "title" | "favicon" | "muted"> {
  return { url: t.url, title: t.title, favicon: t.favicon, muted: t.muted };
}

export function swapPinPage(s: BrowserState, id: string): { state: BrowserState; holderId: string } | null {
  const copy = s.tabs[id];
  const holder = holderOf(s, id);
  if (!copy || !holder) return null;
  const from = holder.windowId;
  const to = copy.windowId;
  const a = holder.id;
  const b = copy.id;
  const windows = { ...s.windows, [from]: swapWindow(s.windows[from]!, a, b), [to]: swapWindow(s.windows[to]!, a, b) };
  const tabs = { ...s.tabs };
  const { pageIn: _held, ...moving } = holder;
  tabs[a] = { ...moving, windowId: to, ...(holder.navigation ? { navigation: { ...holder.navigation, url: holder.url || holder.navigation.url } } : {}) };
  const { unloaded: _u, navigation: _n, adoptId: _a, ...staying } = copy;
  tabs[b] = { ...staying, ...shownFields(holder), windowId: from, navigation: null, pageIn: a };
  for (const t of Object.values(s.tabs)) {
    if (t.id === a || t.id === b || !t.openerId) continue;
    if (t.windowId === from && t.openerId === a) tabs[t.id] = { ...t, openerId: b };
    else if (t.windowId === to && t.openerId === b) tabs[t.id] = { ...t, openerId: a };
  }
  let groups = s.groups;
  for (const g of Object.values(s.groups)) {
    if (g.windowId !== from && g.windowId !== to) continue;
    const tabIds = swapIds(g.tabIds, a, b);
    const opener = g.pinnedOpenerId === (g.windowId === from ? a : b) ? (g.windowId === from ? b : a) : g.pinnedOpenerId;
    if (tabIds === g.tabIds && opener === g.pinnedOpenerId) continue;
    if (groups === s.groups) groups = { ...s.groups };
    groups[g.id] = { ...g, tabIds, ...(opener !== g.pinnedOpenerId ? { pinnedOpenerId: opener } : {}) } as TabGroup;
  }
  let selection = s.selection;
  for (const w of [from, to]) {
    const ids = s.selection[w];
    if (!ids) continue;
    const next = swapIds(ids, a, b);
    if (next !== ids) selection = { ...selection, [w]: next };
  }
  const live = { ...s.live, [b]: { ...(s.live[a] ?? s.live[b]!) } };
  return { state: { ...s, tabs, windows, groups, selection, live }, holderId: a };
}

export function frozenCopiesOf(s: BrowserState, holderId: string): Tab[] {
  return frozenIds(s).map((id) => s.tabs[id]!).filter((t) => t.pageIn === holderId);
}

const frozenMemo = new WeakMap<object, string[]>();
function frozenIds(s: Pick<BrowserState, "tabs">): string[] {
  const hit = frozenMemo.get(s.tabs);
  if (hit) return hit;
  const ids = Object.values(s.tabs)
    .filter((t) => t.pageIn)
    .map((t) => t.id);
  frozenMemo.set(s.tabs, ids);
  return ids;
}

function frozenAfter(s: BrowserState, prev: BrowserState): string[] {
  const known = frozenMemo.get(prev.tabs);
  if (!known) return frozenIds(s);
  const out = new Set(known.filter((id) => s.tabs[id]?.pageIn));
  for (const id of changedIds(s.tabs, prev.tabs)) if (s.tabs[id]?.pageIn) out.add(id);
  const ids = [...out];
  frozenMemo.set(s.tabs, ids);
  return ids;
}

export function withSharedFamily(s: BrowserState, ids: string[]): string[] {
  const out = new Set(ids);
  const frozen = frozenIds(s);
  if (!frozen.length) return ids;
  for (const id of ids) {
    const t = s.tabs[id];
    if (t?.pageIn) out.add(t.pageIn);
  }
  for (const f of frozen) {
    const t = s.tabs[f]!;
    if (out.has(t.pageIn!)) out.add(f);
  }
  return [...out];
}

const LIVE_KEYS = ["isLoading", "canGoBack", "canGoForward", "playingAudio", "themeColor"] as const;
const sameLive = (x: TabLive | undefined, y: TabLive | undefined) => !!x && !!y && LIVE_KEYS.every((k) => x[k] === y[k]);

const shownIn = (s: BrowserState, t: Tab) => s.windows[t.windowId]?.activeTabIds[t.profileId] === t.id;

function splitLeavers(s: BrowserState, prev: BrowserState): string[] {
  if (s.splits === prev.splits) return [];
  const now = new Set(Object.values(s.splits).flatMap((v) => v.tabIds));
  return Object.values(prev.splits).flatMap((v) => v.tabIds).filter((id) => !now.has(id));
}

function oneOwnerPerPin(s: BrowserState, prev: BrowserState): BrowserState {
  const gained = s.tabs === prev.tabs ? [] : changedIds(s.tabs, prev.tabs).filter((id) => {
    const t = s.tabs[id];
    const was = prev.tabs[id];
    return !!t && hasPage(t) && !(was && hasPage(was) && !splitOf(prev, id));
  });
  const candidates = [...new Set([...gained, ...splitLeavers(s, prev)])];
  if (!candidates.length) return s;
  let tabs = s.tabs;
  const freeze = (loser: Tab, keeper: Tab) => {
    if (tabs === s.tabs) tabs = { ...s.tabs };
    const { navigation: _n, adoptId: _a, unloaded: _u, ...rest } = loser;
    tabs[loser.id] = { ...rest, ...shownFields(keeper), navigation: null, pageIn: keeper.id };
    for (const t of Object.values(tabs)) if (t.pageIn === loser.id) tabs[t.id] = { ...t, pageIn: keeper.id };
  };
  for (const id of candidates) {
    const view: BrowserState = tabs === s.tabs ? s : { ...s, tabs };
    const c = tabs[id];
    if (!shares(view, c) || !hasPage(c) || c.pageIn) continue;
    const family = Object.values(tabs).filter((x) => x.id !== c.id && x.windowId !== c.windowId && holds(view, x, c));
    if (!family.length) continue;
    const newcomer = gained.includes(c.id) && !splitOf(prev, c.id);
    const all = newcomer ? family : [c, ...family];
    const keeper = all.reduce((x, y) => (y.lastActiveAt > x.lastActiveAt ? y : x));
    for (const loser of [c, ...family]) if (loser.id !== keeper.id) freeze(loser, keeper);
  }
  return tabs === s.tabs ? s : { ...s, tabs };
}

export function settleSharedPins(next: BrowserState, prev: BrowserState): BrowserState | null {
  if (next.tabs === prev.tabs && next.live === prev.live && next.windows === prev.windows && next.groups === prev.groups && next.splits === prev.splits) return null;
  const s = oneOwnerPerPin(next, prev);
  const frozen = frozenAfter(s, prev);
  if (!frozen.length) return s === next ? null : s;
  let tabs = s.tabs;
  let live = s.live;
  let windows = s.windows;
  const edit = (id: string, patch: Partial<Tab>) => {
    if (tabs === s.tabs) tabs = { ...s.tabs };
    tabs[id] = { ...tabs[id]!, ...patch };
  };
  for (const id of frozen) {
    const t = s.tabs[id]!;
    const holder = s.tabs[t.pageIn!];
    if (holder && !hasPage(t) && shares(s, holder) && holder.windowId === t.windowId && holder.profileId === t.profileId && pinKeyOf(holder) === pinKeyOf(t) && hasPage(holder)) {
      const w = windows[t.windowId]!;
      const active = Object.entries(w.activeTabIds);
      if (active.some(([, x]) => x === t.id)) {
        if (windows === s.windows) windows = { ...s.windows };
        windows[w.id] = { ...w, activeTabIds: Object.fromEntries(active.map(([p, x]) => [p, x === t.id ? holder.id : x])) };
      }
      edit(id, { pageIn: undefined, unloaded: true });
      continue;
    }
    if (hasPage(t) || !holds(s, holder, t) || !shares(s, t)) {
      const shown = shownIn(s, t) && !hasPage(t) && !!t.url;
      edit(id, { pageIn: undefined, ...(hasPage(t) ? {} : shown ? wake(t) : { unloaded: true }) });
      continue;
    }
    const fields = shownFields(holder);
    if ((Object.keys(fields) as (keyof typeof fields)[]).some((k) => t[k] !== fields[k])) edit(id, fields);
    if (!sameLive(live[id], live[holder.id]) && live[holder.id]) {
      if (live === s.live) live = { ...s.live };
      live[id] = { ...live[holder.id]! };
    }
  }
  if (tabs === s.tabs && live === s.live && windows === s.windows) return s === next ? null : s;
  return { ...s, tabs, live, windows };
}

export function returnSharedPages(s: BrowserState, windowId: string): BrowserState {
  const w = s.windows[windowId];
  if (!mirrored(w) || !frozenIds(s).length) return s;
  let next = s;
  for (const id of w.tabIds) {
    const t = next.tabs[id];
    if (!t || !hasPage(t)) continue;
    const order = next.ui.focusOrder;
    const copies = frozenCopiesOf(next, id).filter((c) => c.windowId !== windowId && next.windows[c.windowId]);
    if (!copies.length) continue;
    const rank = (c: Tab) => {
      const at = order.indexOf(c.windowId);
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const target = copies.reduce((x, y) => (rank(y) < rank(x) ? y : x));
    const swapped = swapPinPage(next, target.id);
    if (swapped) next = swapped.state;
  }
  return next;
}
