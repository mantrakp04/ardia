import type { BrowserState } from "./browser";
import { changedIds } from "./changes";
import { orderSections, syncGroupOrder, withParent } from "./groups";
import { IDLE_LIVE, inPinnedContainer, newId, pinnedFirst } from "./model";
import { chainOf, copyOf, hasDuplicates, keyField, mirrored, pinKeyOf, profilesOf, sectionOf, signature, treeOrder, union } from "./pinMirror";
import { removeTabs, withNewTab } from "./tabs";
import type { Tab, TabGroup } from "./types";

type Section = ReturnType<typeof sectionOf>;

const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;
const familyKey = (t: Pick<Tab, "profileId" | "id" | "pinKey">) => `${t.profileId}\u0001${pinKeyOf(t)}`;

export const sharesTabs = (s: Pick<BrowserState, "settings">) => !!s.settings?.shareTabsAcrossWindows;

const listable = (t: Tab) => !t.pinned && !!t.url && !t.liveItem;

export function sharedListTab(s: BrowserState, t: Tab): boolean {
  return sharesTabs(s) && listable(t) && mirrored(s.windows[t.windowId]) && !inPinnedContainer(s, t.id) && s.peeks[t.windowId]?.tabId !== t.id;
}

function listMember(s: BrowserState): (t: Tab) => boolean {
  const pinnedMembers = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  const inSplit = new Set(Object.values(s.splits).flatMap((v) => v.tabIds));
  return (t) => listable(t) && !pinnedMembers.has(t.id) && !inSplit.has(t.id) && s.peeks[t.windowId]?.tabId !== t.id;
}

const listGroupsOf = (s: Pick<BrowserState, "groups">) => Object.values(s.groups).filter((g) => !g.pinned);

function listSection(s: BrowserState, windowId: string, profileId: string, member = listMember(s), groups = listGroupsOf(s)): Section {
  return sectionOf(s, s.windows[windowId]!, profileId, groups, member);
}

const LIST_FIELDS = ["pinned", "profileId", "windowId", "pinKey", "customTitle", "customIcon", "liveItem", "pageIn"] as const;
function listMayDiffer(s: BrowserState, prev: BrowserState): boolean {
  if (s.windows !== prev.windows || s.groups !== prev.groups || s.splits !== prev.splits || s.peeks !== prev.peeks) return true;
  if (s.tabs === prev.tabs) return false;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) return true;
    if (LIST_FIELDS.some((f) => a[f] !== b[f]) || hasPage(a) !== hasPage(b) || !a.url !== !b.url) return true;
  }
  return false;
}

type Leaving = "close" | "keepPages";

const swapIn = (ids: string[], a: string, b: string) => (ids.includes(a) || ids.includes(b) ? ids.map((x) => (x === a ? b : x === b ? a : x)) : ids);

function swapPlaces(s: BrowserState, a: string, b: string): BrowserState {
  const ta = s.tabs[a]!;
  const tb = s.tabs[b]!;
  const key = pinKeyOf(ta);
  const moved = ta.windowId !== tb.windowId;
  const windows = { ...s.windows };
  for (const id of new Set([ta.windowId, tb.windowId])) {
    const w = windows[id]!;
    const activeTabIds = moved ? Object.fromEntries(Object.entries(w.activeTabIds).map(([p, x]) => [p, x === a ? b : x === b ? a : x])) : w.activeTabIds;
    windows[id] = { ...w, tabIds: swapIn(w.tabIds, a, b), activeTabIds };
  }
  const swapAll = <T extends { tabIds: string[] }>(all: Record<string, T>): Record<string, T> => {
    let out = all;
    for (const [id, x] of Object.entries(all)) {
      const tabIds = swapIn(x.tabIds, a, b);
      if (tabIds !== x.tabIds) (out === all ? (out = { ...all }) : out)[id] = { ...x, tabIds };
    }
    return out;
  };
  const slotOf = (t: Tab): Partial<Tab> => ({ windowId: t.windowId, pinned: t.pinned, pinnedUrl: t.pinnedUrl, pinnedAsRow: t.pinnedAsRow, tileFolder: t.tileFolder });
  const tabs = { ...s.tabs };
  tabs[a] = { ...ta, ...slotOf(tb), ...keyField(a, key), ...(moved && ta.navigation ? { navigation: { ...ta.navigation, url: ta.url || ta.navigation.url } } : {}) };
  tabs[b] = { ...tb, ...slotOf(ta), ...keyField(b, key) };
  return { ...s, tabs, windows, groups: swapAll(s.groups), splits: swapAll(s.splits) };
}

export function pagesIntoSplits(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (!sharesTabs(s) || s.splits === prev.splits) return null;
  const inSplit = (st: BrowserState, id: string) => Object.values(st.splits).some((v) => v.tabIds.includes(id));
  let next = s;
  for (const v of Object.values(s.splits)) {
    for (const id of v.tabIds) {
      const t = next.tabs[id];
      const was = prev.tabs[id];
      if (!t?.pageIn || hasPage(t) || !(sharedListTab(next, t) || (was && sharedListTab(prev, was)))) continue;
      const holder = next.tabs[t.pageIn];
      if (!holder || holder.pinned || !hasPage(holder) || holder.pageIn || holder.windowId === t.windowId || holder.profileId !== t.profileId || pinKeyOf(holder) !== pinKeyOf(t) || inSplit(next, holder.id)) continue;
      next = swapPlaces(next, holder.id, t.id);
      next = removeTabs(keepShownProfile(next, holder.windowId, [t.id]), [t.id], false);
    }
  }
  return next === s ? null : next;
}

function keepLeavingPages(s: BrowserState, windowId: string, profileId: string, spec: Section, sourceId: string | undefined): BrowserState {
  const wanted = new Set(spec.items.map((i) => pinKeyOf(i.tab)));
  const section = listSection(s, windowId, profileId);
  const inList = new Set(section.items.map((i) => i.tab.id));
  let next = s;
  for (const { tab: t } of section.items) {
    if (!hasPage(t) || t.pageIn || wanted.has(pinKeyOf(t))) continue;
    const key = pinKeyOf(t);
    const pageless = (id: string | undefined) =>
      id ? next.windows[id]?.tabIds.map((x) => next.tabs[x]).find((u) => !!u && u.id !== t.id && !inList.has(u.id) && u.profileId === t.profileId && pinKeyOf(u) === key && !hasPage(u)) : undefined;
    const place = pageless(windowId) ?? (sourceId !== windowId ? pageless(sourceId) : undefined);
    if (place) next = swapPlaces(next, t.id, place.id);
  }
  return next;
}

function conformList(input: BrowserState, windowId: string, profileId: string, spec: Section, leaving: Leaving, sourceId?: string): BrowserState {
  const s = leaving === "close" ? keepLeavingPages(input, windowId, profileId, spec, sourceId) : input;
  const w = s.windows[windowId]!;
  const cur = listSection(s, windowId, profileId);
  const mine = cur.items.map((i) => i.tab);
  const used = new Set<string>();
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  let groups = { ...s.groups };
  const byKey = new Map<string, Tab[]>();
  for (const m of mine) byKey.get(pinKeyOf(m))?.push(m) ?? byKey.set(pinKeyOf(m), [m]);
  const reuse = (src: Tab): string => {
    const key = pinKeyOf(src);
    const same = (byKey.get(key) ?? []).filter((m) => !used.has(m.id));
    const t = same.find(hasPage) ?? same[0];
    if (!t) {
      const { unloaded: _, ...made } = copyOf(src, windowId, false);
      const copy = { ...made, lastActiveAt: src.lastActiveAt };
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      used.add(copy.id);
      return copy.id;
    }
    used.add(t.id);
    const patch: Partial<Tab> = { ...keyField(t.id, key), customTitle: src.customTitle, customIcon: src.customIcon };
    if (!hasPage(t) && !t.pageIn) Object.assign(patch, { url: src.url, title: src.title, favicon: src.favicon });
    if ((Object.keys(patch) as (keyof Tab)[]).some((k) => t[k] !== patch[k])) tabs[t.id] = { ...t, ...patch };
    return t.id;
  };
  const order = treeOrder(spec);
  const placed = order.map((i) => reuse(i.tab));
  const within = new Map<string, string[]>();
  order.forEach((i, n) => {
    for (const key of chainOf(spec, i.group)) within.get(key)?.push(placed[n]!) ?? within.set(key, [placed[n]!]);
  });

  const out = mine.filter((t) => !used.has(t.id));
  const demoted = new Set(leaving === "keepPages" ? out.filter(hasPage).map((t) => t.id) : []);
  const gone = out.filter((t) => !demoted.has(t.id)).map((t) => t.id);
  for (const id of demoted) tabs[id] = { ...tabs[id]!, pinKey: undefined };
  const section = new Set(mine.filter((t) => !demoted.has(t.id)).map((t) => t.id));
  const kept = new Set(placed);
  const followers = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const id of w.tabIds) {
    if (section.has(id) && kept.has(id)) anchor = id;
    if (section.has(id) && !gone.includes(id)) continue;
    followers.get(anchor)?.push(id) ?? followers.set(anchor, [id]);
  }
  const ids = [...(followers.get(null) ?? [])];
  for (const id of placed) ids.push(id, ...(followers.get(id) ?? []));

  const usedGroups = new Set<string>();
  const groupIdOf = new Map<string, string>();
  for (const [key, members] of within) {
    const { group: src, parent } = spec.groups.get(key)!;
    const own = cur.own.find((g) => !usedGroups.has(g.id) && pinKeyOf(g) === key);
    const id = own?.id ?? newId("g");
    usedGroups.add(id);
    groupIdOf.set(key, id);
    const outside = own ? own.tabIds.filter((x) => !section.has(x) && ids.includes(x)) : [];
    const base: TabGroup = own ?? {
      id,
      windowId,
      profileId,
      name: "",
      icon: null,
      color: null,
      collapsed: src.collapsed,
      pinned: false,
      tabIds: [],
      createdAt: Date.now(),
      ...(src.autoUngroup ? { autoUngroup: true } : {}),
    };
    groups[id] = withParent({ ...base, ...keyField(id, key), name: src.name, icon: src.icon, color: src.color, pinned: false, tabIds: [...members, ...outside] }, parent ? groupIdOf.get(parent) : undefined);
  }
  for (const g of cur.own) {
    if (usedGroups.has(g.id)) continue;
    const left = g.tabIds.filter((x) => (!section.has(x) || demoted.has(x)) && ids.includes(x));
    if (left.length) groups[g.id] = { ...g, pinKey: undefined, tabIds: left };
    else delete groups[g.id];
  }
  for (const g of cur.own) if (groups[g.id]?.parentId && !groups[groups[g.id]!.parentId!]) groups[g.id] = withParent(groups[g.id]!, undefined);

  const window = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs, groups), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  let next: BrowserState = { ...s, tabs, live, groups, windows: { ...s.windows, [windowId]: window } };
  if (!gone.length) return next;
  return removeTabs(keepShownProfile(next, windowId, gone), gone, false);
}

function keepShownProfile(s: BrowserState, windowId: string, gone: readonly string[]): BrowserState {
  const w = s.windows[windowId];
  if (!w || !w.tabIds.some((id) => gone.includes(id))) return s;
  const shownHere = w.tabIds.filter((id) => s.tabs[id]?.profileId === w.profileId && !gone.includes(id));
  if (w.tabIds.some((id) => !gone.includes(id)) && shownHere.some((id) => !s.tabs[id]!.unloaded)) return s;
  return withNewTab(s, windowId, { profileId: w.profileId, background: true })[0];
}

function linkCopies(s: BrowserState, byProfile: Map<string, string[]>): BrowserState {
  const member = listMember(s);
  const groups = listGroupsOf(s);
  const holders = new Map<string, Tab>();
  const copies: Tab[] = [];
  const asleep: Tab[] = [];
  for (const [profileId, ids] of byProfile) {
    for (const id of ids) {
      if (!s.windows[id]) continue;
      for (const { tab } of listSection(s, id, profileId, member, groups).items) {
        if (tab.unloaded) asleep.push(tab);
        if (ids.length < 2) continue;
        if (hasPage(tab) && !tab.pageIn) {
          const was = holders.get(familyKey(tab));
          if (!was || tab.lastActiveAt > was.lastActiveAt) holders.set(familyKey(tab), tab);
        } else if (!hasPage(tab) && !tab.pageIn) copies.push(tab);
      }
    }
  }
  let tabs = s.tabs;
  for (const t of asleep) {
    if (tabs === s.tabs) tabs = { ...s.tabs };
    const { unloaded: _, ...rest } = t;
    tabs[t.id] = rest;
  }
  for (const c of copies) {
    const holder = holders.get(familyKey(c));
    if (!holder || holder.windowId === c.windowId) continue;
    if (tabs === s.tabs) tabs = { ...s.tabs };
    tabs[c.id] = { ...tabs[c.id]!, url: holder.url, title: holder.title, favicon: holder.favicon, muted: holder.muted, pageIn: holder.id };
  }
  return tabs === s.tabs ? s : { ...s, tabs };
}

export function mirrorTabs(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (!sharesTabs(s)) return null;
  const turnedOn = !sharesTabs(prev);
  if (!turnedOn && !listMayDiffer(s, prev)) return null;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => mirrored(s.windows[id]));
  const byProfile = new Map<string, string[]>();
  for (const id of order) for (const p of profilesOf(s, s.windows[id]!)) byProfile.set(p, [...(byProfile.get(p) ?? []), id]);
  let next = s;
  for (const [profileId, ids] of byProfile) {
    for (const id of ids) {
      const x = listSection(next, id, profileId);
      if (hasDuplicates(x)) next = conformList(next, id, profileId, union([x], false), "keepPages");
    }
  }
  for (const [profileId, ids] of byProfile) {
    if (ids.length < 2) continue;
    const member = listMember(next);
    const groups = listGroupsOf(next);
    const sections = new Map(ids.map((id) => [id, listSection(next, id, profileId, member, groups)]));
    const sigs = new Map(ids.map((id) => [id, signature(sections.get(id)!)]));
    if (new Set(sigs.values()).size === 1) continue;
    const before = turnedOn ? [] : ids.filter((id) => mirrored(prev.windows[id]) && profilesOf(prev, prev.windows[id]!).has(profileId));
    const prevMember = listMember(prev);
    const prevGroups = listGroupsOf(prev);
    const source = before.find((id) => signature(listSection(prev, id, profileId, prevMember, prevGroups)) !== sigs.get(id));
    const merged = turnedOn ? [...ids].sort((x, y) => s.windowOrder.indexOf(x) - s.windowOrder.indexOf(y)) : [...before, ...ids.filter((id) => !before.includes(id))];
    const spec: Section = source ? sections.get(source)! : union(merged.map((id) => sections.get(id)!), false);
    const want = source ? sigs.get(source)! : null;
    for (const id of ids) {
      if (id === source || (want !== null && sigs.get(id) === want) || !next.windows[id]) continue;
      next = conformList(next, id, profileId, spec, source ? "close" : "keepPages", source);
    }
  }
  next = linkCopies(next, byProfile);
  return next === s ? null : next;
}

export function unshareTabs(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (sharesTabs(s) || !sharesTabs(prev)) return null;
  const member = listMember(s);
  const rank = new Map([...new Set([...s.ui.focusOrder, ...s.windowOrder])].map((id, i) => [id, i]));
  const families = new Map<string, Tab[]>();
  for (const t of Object.values(s.tabs)) {
    if (!mirrored(s.windows[t.windowId]) || !member(t)) continue;
    families.get(familyKey(t))?.push(t) ?? families.set(familyKey(t), [t]);
  }
  const gone: string[] = [];
  const tabs = { ...s.tabs };
  for (const family of families.values()) {
    const at = (t: Tab) => rank.get(t.windowId) ?? Number.MAX_SAFE_INTEGER;
    const keeper = family.find((t) => hasPage(t) && !t.pageIn) ?? family.reduce((x, y) => (at(y) < at(x) ? y : x));
    for (const t of family) {
      if (t.id !== keeper.id) gone.push(t.id);
      else if (t.pinKey || t.pageIn) {
        const { pageIn: _p, ...rest } = t;
        tabs[t.id] = { ...rest, pinKey: undefined };
      }
    }
  }
  const groups = { ...s.groups };
  for (const g of listGroupsOf(s)) if (g.pinKey) groups[g.id] = { ...g, pinKey: undefined };
  let next: BrowserState = { ...s, tabs, groups };
  for (const w of Object.values(s.windows)) next = keepShownProfile(next, w.id, gone);
  return gone.length ? removeTabs(next, gone, false) : next;
}

export function sharedElsewhere(s: BrowserState, t: Tab): boolean {
  if (!sharedListTab(s, t)) return false;
  const key = pinKeyOf(t);
  return Object.values(s.tabs).some((x) => x.id !== t.id && x.windowId !== t.windowId && x.profileId === t.profileId && pinKeyOf(x) === key && mirrored(s.windows[x.windowId]));
}

export function sharedLastUsed(s: BrowserState): Map<string, number> | null {
  if (!sharesTabs(s)) return null;
  const member = listMember(s);
  const out = new Map<string, number>();
  for (const t of Object.values(s.tabs)) {
    if (!mirrored(s.windows[t.windowId]) || !member(t)) continue;
    const key = familyKey(t);
    out.set(key, Math.max(out.get(key) ?? 0, t.lastActiveAt));
  }
  return out;
}

export const lastUsedOf = (used: Map<string, number> | null, t: Tab) => used?.get(familyKey(t)) ?? t.lastActiveAt;

export function sharedTabsIn(tabs: Record<string, Tab>, windowId: string): { elsewhere(t: Tab): boolean; lastUsed(t: Tab): number } {
  const here = new Set<string>();
  const used = new Map<string, number>();
  for (const t of Object.values(tabs)) {
    if (t.pinned) continue;
    const key = familyKey(t);
    if (t.windowId === windowId) here.add(key);
    used.set(key, Math.max(used.get(key) ?? 0, t.lastActiveAt));
  }
  return {
    elsewhere: (t) => !t.pinned && t.windowId !== windowId && here.has(familyKey(t)),
    lastUsed: (t) => (t.pinned ? t.lastActiveAt : (used.get(familyKey(t)) ?? t.lastActiveAt)),
  };
}

export function openTabsByUse(
  tabs: Record<string, Tab>,
  peeks: BrowserState["peeks"],
  o: { profileId: string; windowId: string; shared: boolean },
): { tab: Tab; lastActiveAt: number }[] {
  const view = o.shared ? sharedTabsIn(tabs, o.windowId) : null;
  return Object.values(tabs)
    .filter((t) => t.profileId === o.profileId && peeks[t.windowId]?.tabId !== t.id && !view?.elsewhere(t))
    .map((t) => ({ tab: t, lastActiveAt: view ? view.lastUsed(t) : t.lastActiveAt }));
}
