import { TAB_GROUP_COLORS } from "@ardia/core";
import type { StripGroup, StripState, StripTab } from "../../platform/tabs";
import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { rootOf } from "../groups/groups";
import { engineProfile } from "../browser/model";
import { forgetOpeners, switchKeepsOpeners } from "./openers";
import { groupOf, withGroup } from "../pins/tabGrouping";
import { placing } from "../pins/placing";
import { isPeekTab, withoutPeek } from "../peek/peek";
import { settleMovedPins } from "../pins/pinMirror";
import { splitOf, splitTabIdsOf } from "../splits/splits";
import { activated, apply, removeTabs } from "./tabs";
import { isAdoptKind } from "./adoptIds";
import { adoptOf } from "./pageSession";
import { orderSections } from "../groups/groups";

type Keyed = StripTab & { key: string };
const known = (s: BrowserState, t: StripTab | undefined): t is Keyed => !!t?.key && !!s.tabs[t.key] && !isPeekTab(s, t.key);

const chromeGroupOf = (s: BrowserState, key: string | undefined) => {
  const g = groupOf(s, key);
  return g && rootOf(s.groups, g.id);
};

const madeByChrome = (s: BrowserState, key: string) => isAdoptKind(adoptOf(s.tabs[key]), "tab");
const CHROME_COLORS = new Set<string>(TAB_GROUP_COLORS);
const chromeColor = (color: TabGroup["color"]): StripGroup["color"] => (color && CHROME_COLORS.has(color) ? (color as StripGroup["color"]) : "grey");

export type Pending = { arranged: ReadonlySet<string>; grouped?: ReadonlySet<string>; regrouped?: ReadonlySet<string>; active: boolean };
const NOTHING_PENDING: Pending = { arranged: new Set(), active: false };

export type GroupBindings = Map<string, string>;

export function chromeChanged(
  s: BrowserState,
  before: StripState | undefined,
  after: StripState,
  context: { seen: ReadonlySet<string>; siblings?: StripState[]; pending?: Pending; groups?: GroupBindings },
): BrowserState {
  const { seen, siblings = [], pending = NOTHING_PENDING, groups = new Map() } = context;
  const was = new Map((before?.tabs ?? []).map((t) => [t.browser, t]));
  const now = after.tabs.filter((t): t is Keyed => known(s, t));
  const stayed = (t: Keyed) => was.get(t.browser)?.key === t.key;
  const firstFromChrome = (t: Keyed) => !stayed(t) && !seen.has(t.key) && madeByChrome(s, t.key);
  const home = homeWindow(s, after, siblings, stayed);
  const movedIn = (t: Keyed) =>
    !was.has(t.browser) && !!home && s.tabs[t.key]!.windowId !== home && engineProfile(s, s.tabs[t.key]!.profileId) === after.profile;
  const taken = new Set(now.filter((t) => firstFromChrome(t) || movedIn(t)).map((t) => t.key));

  for (const t of now) if (movedIn(t)) s = intoWindow(s, t.key, home!);

  const followed = now.filter((t) => (stayed(t) || taken.has(t.key)) && !pending.arranged.has(t.key));
  const weight = (t: Keyed) => (groupOf(s, t.key) ? 2 : 1);
  const kept = new Set([
    ...keptOrder(followed.filter(stayed), (t) => was.get(t.browser)!.index, weight).map((t) => t.key),
    ...pending.arranged,
    ...(pending.regrouped ?? []),
  ]);
  const settled = new Set(kept);
  const chromeGroup = (t: Keyed): string | null | undefined => {
    if (t.group === undefined) return undefined;
    if (t.group === null) return null;
    const id = groups.get(t.group);
    return id && s.groups[id] ? id : undefined;
  };
  for (const t of [...followed].reverse()) {
    const tab = s.tabs[t.key];
    if (!tab) continue;
    if (!!tab.pin !== t.pinned && splitOf(s, t.key)) continue;
    const pinFlip = !!tab.pin !== t.pinned && (taken.has(t.key) || was.get(t.browser)!.pinned !== t.pinned);
    if (kept.has(t.key) && !pinFlip) continue;
    s = placeLike(s, t.key, pinFlip ? t.pinned : !!tab.pin, now, settled, kept, chromeGroup(t));
    settled.add(t.key);
  }
  for (const t of followed) {
    const want = chromeGroup(t);
    if (want === undefined || !s.tabs[t.key] || s.tabs[t.key]!.pin || t.pinned || kept.has(t.key)) continue;
    if ((chromeGroupOf(s, t.key)?.id ?? null) !== want) s = regroupInPlace(s, t.key, want);
  }

  if (reportsGroups(after)) s = groupsChanged(s, before, after, now, (t) => stayed(t) || taken.has(t.key), taken, groups, pending);

  if (!pending.active) {
    const active = after.tabs.find((t) => t.active);
    const previous = before?.tabs.find((t) => t.active);
    const left =
      after.activePickedOnClose ?? (!!previous && !after.tabs.some((t) => t.browser === previous.browser));
    if (known(s, active) && taken.has(active.key)) s = show(s, active.key);
    else if (known(s, active) && stayed(active) && active.browser !== previous?.browser && !left) s = show(s, active.key);
    else if (known(s, active)) {
      const front = now.find((t) => taken.has(t.key) && !t.active && shownIn(s, t.key));
      if (front) s = show(s, active.key);
    }
  }
  return s;
}

const reportsGroups = (strip: StripState) => strip.tabs.some((t) => t.group !== undefined);

function groupsChanged(
  s: BrowserState,
  before: StripState | undefined,
  after: StripState,
  now: Keyed[],
  followed: (t: Keyed) => boolean,
  taken: ReadonlySet<string>,
  bound: GroupBindings,
  pending: Pending,
): BrowserState {
  const was = new Map((before?.tabs ?? []).map((t) => [t.browser, t.group ?? null]));
  const looks = new Map((after.groups ?? []).map((g) => [g.id, g]));
  const looksBefore = new Map((before?.groups ?? []).map((g) => [g.id, g]));
  for (const t of now) {
    const tab = s.tabs[t.key];
    if (!tab || tab.pin || !followed(t) || pending.grouped?.has(t.key)) continue;
    const token = t.group ?? null;
    if (!taken.has(t.key) && was.get(t.browser) === token) continue;
    const current = chromeGroupOf(s, t.key);
    if (token === null) {
      if (current) s = regroupInPlace(s, t.key, null);
      continue;
    }
    const id = bound.get(token);
    if (id && s.groups[id]) {
      if (current?.id !== id) s = regroupInPlace(s, t.key, id);
      continue;
    }
    const members = now.filter((x) => x.group === token && s.tabs[x.key] && !s.tabs[x.key]!.pin).map((x) => x.key);
    const [next, made] = withGroup(s, members, { pinned: false, name: looks.get(token)?.title ?? "", parentId: null });
    if (!made) continue;
    bound.set(token, made);
    s = withLook(next, made, looks.get(token));
  }
  for (const [token, look] of looks) {
    const id = bound.get(token);
    const was = looksBefore.get(token);
    if (!id || !s.groups[id] || (was && was.title === look.title && was.color === look.color && was.collapsed === look.collapsed)) continue;
    if (s.groups[id]!.tabIds.some((key) => pending.grouped?.has(key))) continue;
    s = withLook(s, id, look);
  }
  return s;
}

function regroupInPlace(s: BrowserState, key: string, groupId: string | null): BrowserState {
  const w = s.windows[s.tabs[key]!.windowId];
  if (!w) return s;
  const beforeId = w.tabIds[w.tabIds.indexOf(key) + 1] ?? null;
  return placing(s, [key], { pinned: false, beforeId, groupId });
}

function withLook(s: BrowserState, id: string, look: StripGroup | undefined): BrowserState {
  const g = s.groups[id];
  if (!g || !look) return s;
  const color = look.color === chromeColor(g.color) ? g.color : look.color;
  if (g.name === look.title && g.color === color && g.collapsed === look.collapsed) return s;
  return { ...s, groups: { ...s.groups, [id]: { ...g, name: look.title, color, collapsed: look.collapsed } } };
}

type GroupStep = {
  keys: string[];
  group: string | null;
  title?: string;
  color?: StripGroup["color"];
  collapsed?: boolean;
  makes?: string;
};

export function groupStep(s: BrowserState, strip: StripState, bound: GroupBindings): GroupStep | null {
  if (!reportsGroups(strip)) return null;
  const tabs = strip.tabs.filter((t): t is Keyed => known(s, t) && !t.pinned && !s.tabs[t.key]!.pin);
  const looks = new Map((strip.groups ?? []).map((g) => [g.id, g]));
  const tokenOf = (id: string) => [...bound].find(([token, g]) => g === id && looks.has(token))?.[0];
  const strays = tabs.filter((t) => t.group && t.group !== (chromeGroupOf(s, t.key) ? tokenOf(chromeGroupOf(s, t.key)!.id) : undefined));
  if (strays.length) return { keys: strays.map((t) => t.key), group: null };
  const storeGroups = [...new Set(tabs.map((t) => chromeGroupOf(s, t.key)).filter((g) => !!g))];
  for (const g of storeGroups) {
    const keys = tabs.filter((t) => chromeGroupOf(s, t.key)?.id === g!.id).map((t) => t.key);
    const token = tokenOf(g!.id);
    const look = { title: g!.name, color: chromeColor(g!.color), collapsed: g!.collapsed };
    if (!token) return { keys, group: "new", ...look, makes: g!.id };
    const missing = tabs.filter((t) => keys.includes(t.key) && t.group !== token).map((t) => t.key);
    if (missing.length) return { keys: missing, group: token };
    const now = looks.get(token)!;
    if (now.title !== look.title || now.color !== look.color || now.collapsed !== look.collapsed) return { keys, group: token, ...look };
  }
  return null;
}

function homeWindow(s: BrowserState, strip: StripState, siblings: StripState[], stayed: (t: Keyed) => boolean): string | undefined {
  if (strip.appWindow && s.windows[strip.appWindow]) return strip.appWindow;
  const mine = strip.tabs.filter((t): t is Keyed => known(s, t) && stayed(t));
  const other = siblings.flatMap((x) => x.tabs).filter((t): t is Keyed => known(s, t));
  const t = mine[0] ?? other[0];
  return t && s.windows[s.tabs[t.key]!.windowId] ? s.tabs[t.key]!.windowId : undefined;
}

const shownIn = (s: BrowserState, key: string) => {
  const tab = s.tabs[key]!;
  return s.windows[tab.windowId]?.activeTabIds[tab.profileId] === key;
};

function keptOrder<T>(items: T[], oldIndex: (t: T) => number, weight: (t: T) => number): T[] {
  const best: number[] = [];
  const back: number[] = [];
  let end = -1;
  items.forEach((t, i) => {
    best[i] = weight(t);
    back[i] = -1;
    for (let j = 0; j < i; j++) {
      if (oldIndex(items[j]!) < oldIndex(t) && best[j]! + weight(t) > best[i]!) {
        best[i] = best[j]! + weight(t);
        back[i] = j;
      }
    }
    if (end < 0 || best[i]! > best[end]!) end = i;
  });
  const out: T[] = [];
  for (let i = end; i >= 0; i = back[i]!) out.push(items[i]!);
  return out.reverse();
}

function placeLike(
  s: BrowserState,
  key: string,
  pinned: boolean,
  strip: Keyed[],
  settled: ReadonlySet<string>,
  kept: ReadonlySet<string>,
  group?: string | null,
): BrowserState {
  const w = s.windows[s.tabs[key]!.windowId];
  if (!w) return s;
  const panes = splitTabIdsOf(splitOf(s, key)) ?? [key];
  const moving = w.tabIds.filter((id) => panes.includes(id));
  const i = strip.findIndex((t) => t.key === key);
  const other = (t: Keyed) => !!s.tabs[t.key] && !panes.includes(t.key) && s.tabs[t.key]!.windowId === w.id;
  const next = strip.slice(i + 1).find((t) => other(t) && settled.has(t.key))?.key;
  const prior = strip.slice(0, i).reverse().find((t) => other(t) && kept.has(t.key))?.key;
  const rowStart = (id: string) => w.tabIds.find((t) => splitTabIdsOf(splitOf(s, id))?.includes(t)) ?? id;
  const rowAfter = (id: string) => {
    const row = splitTabIdsOf(splitOf(s, id)) ?? [id];
    const last = Math.max(...row.map((t) => w.tabIds.indexOf(t)));
    return w.tabIds.slice(last + 1).find((t) => !moving.includes(t)) ?? null;
  };
  const beforeId = next ? rowStart(next) : prior ? rowAfter(prior) : (w.tabIds.find((t) => !moving.includes(t)) ?? null);
  const own = groupOf(s, key)?.id;
  const around = [groupOf(s, prior)?.id, groupOf(s, next)?.id];
  const guessed = around[0] && around[0] === around[1] ? around[0] : own && around.includes(own) ? own : null;
  const root = own ? rootOf(s.groups, own) : undefined;
  if (!pinned && beforeId === null && own && root && root.id !== own && root.id === group) {
    const last = root.tabIds.filter((id) => !moving.includes(id)).at(-1);
    return placing(s, moving, { pinned, beforeId, groupId: last && s.groups[own]!.tabIds.includes(last) ? own : root.id });
  }
  const wanted = group !== undefined ? (beforeId === null ? null : group) : guessed;
  const groupId = pinned ? null : own && wanted && wanted !== own && root?.id === wanted && group !== undefined ? own : wanted;
  return placing(s, moving, { pinned, beforeId, groupId });
}

function intoWindow(s: BrowserState, key: string, to: string): BrowserState {
  const tab = s.tabs[key]!;
  const live = s.live[key];
  if (!s.windows[to] || tab.windowId === to) return s;
  let next = removeTabs(s, [key], false);
  const w = next.windows[to];
  if (!w) return s;
  const tabs = { ...next.tabs, [key]: { ...tab, windowId: to } };
  next = {
    ...next,
    tabs,
    live: live ? { ...next.live, [key]: live } : next.live,
    windows: { ...next.windows, [to]: { ...w, tabIds: orderSections([...w.tabIds, key], tabs, next.groups) } },
  };
  return settleMovedPins(s, next, [key], to);
}

function show(s: BrowserState, key: string): BrowserState {
  const tab = s.tabs[key]!;
  const w = s.windows[tab.windowId];
  if (!w || w.profileId !== tab.profileId) return s;
  const shown = w.activeTabIds[tab.profileId];
  if (shown === key || (shown && splitTabIdsOf(splitOf(s, shown))?.includes(key))) return s.peeks[w.id] ? withoutPeek(s, w.id) : s;
  let next = apply(s, activated(s, key));
  if (shown && !switchKeepsOpeners(s, shown, key)) next = forgetOpeners(next, w.id);
  return next;
}

type StripPlan = { keys: string[]; pinned: number; active: string | null };

export function stripPlan(s: BrowserState, strip: StripState): StripPlan | null {
  const mine = strip.tabs.filter((t): t is Keyed => known(s, t));
  if (!mine.length) return null;
  const windowId = s.tabs[(mine.find((t) => t.active) ?? mine[0]!).key]!.windowId;
  const w = s.windows[windowId];
  if (!w) return null;
  const inStrip = new Set(mine.map((t) => t.key));
  const keys = w.tabIds.filter((id) => inStrip.has(id));
  const pinned = keys.filter((id) => s.tabs[id]!.pin);
  const profiles = [w.profileId, ...new Set(keys.map((id) => s.tabs[id]!.profileId))];
  const peek = s.peeks[windowId]?.tabId;
  const active = peek && strip.tabs.some((t) => t.key === peek) ? peek : (profiles.map((p) => w.activeTabIds[p]).find((id) => !!id && inStrip.has(id)) ?? null);
  return { keys: [...pinned, ...keys.filter((id) => !s.tabs[id]!.pin)], pinned: pinned.length, active };
}

export function stripActual(strip: StripState, plan: StripPlan): StripPlan {
  const planned = new Set(plan.keys);
  const tabs = strip.tabs.filter((t) => t.key && planned.has(t.key));
  return {
    keys: tabs.map((t) => t.key!),
    pinned: tabs.filter((t) => t.pinned).length,
    active: strip.tabs.find((t) => t.active)?.key ?? null,
  };
}
