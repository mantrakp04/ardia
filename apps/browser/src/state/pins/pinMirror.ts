import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { ancestorIds, depthOf, orderSections, placeBlock, syncGroupOrder, withParent } from "../groups/groups";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinnedFirst, without } from "../browser/model";
import { samePage } from "./organize";
import { hasPage } from "../tabs/pageSession";
import { removeFromSplits } from "../splits/splits";
import { sharedListTab, sharesTabs } from "../tabs/tabShare";
import { removeTabs } from "../tabs/tabs";
import type { BrowserWindow, SplitView, Tab, TabGroup } from "../browser/types";

type Keyed = { id: string; pinKey?: string };
export const pinKeyOf = (x: Keyed) => x.pinKey ?? x.id;
const homeOf = (t: Pick<Tab, "url" | "pinnedUrl">) => t.pinnedUrl || t.url;
export const mirrored = (w: BrowserWindow | undefined): w is BrowserWindow => !!w && !w.incognito && w.kind !== "small";

type Item = { tab: Tab; group: string | null };
type Section = { items: Item[]; groups: Map<string, { group: TabGroup; parent: string | null }>; own: TabGroup[]; duplicate?: boolean; splits?: PinnedSplit[] };
type PinnedSplit = Pick<SplitView, "orientation" | "sizes" | "stack"> & { keys: string[] };

const isTile = (t: Tab) => t.pinned && !t.pinnedAsRow;

function withSplits(s: Pick<BrowserState, "splits">, w: BrowserWindow, x: Section): Section {
  const keyOf = new Map(x.items.filter((i) => !isTile(i.tab)).map((i) => [i.tab.id, pinKeyOf(i.tab)]));
  const splits = Object.values(s.splits)
    .filter((v) => v.windowId === w.id && v.tabIds.every((id) => keyOf.has(id)))
    .map(({ orientation, sizes, stack, tabIds }): PinnedSplit => ({ keys: tabIds.map((id) => keyOf.get(id)!), orientation, sizes, ...(stack ? { stack } : {}) }));
  return { ...x, splits };
}

const splitSig = (v: PinnedSplit) => `S${v.keys.join("\u0003")}\u0001${v.orientation}\u0001${v.stack?.index ?? ""}`;

function innermostPinned(s: Pick<BrowserState, "groups">, own: TabGroup[]): Map<string, TabGroup> {
  const inner = new Map<string, TabGroup>();
  for (const g of own.map((g) => [g, depthOf(s.groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) for (const id of g.tabIds) inner.set(id, g);
  return inner;
}

function pinnedChain(s: Pick<BrowserState, "groups">, g: TabGroup, ownIds: Set<string>): TabGroup[] {
  const up = ancestorIds(s.groups, g.id).filter((id) => ownIds.has(id)).reverse().map((id) => s.groups[id]!);
  return [...up, g];
}

export function sectionOf(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string, pinnedGroups: TabGroup[], member?: (t: Tab) => boolean): Section {
  const mine = pinnedGroups.filter((g) => g.windowId === w.id && g.profileId === profileId);
  const ownIds = new Set(mine.map((g) => g.id));
  const inner = innermostPinned(s, mine);
  const x: Section = { items: [], groups: new Map(), own: [] };
  const owned = new Set<string>();
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (!t || t.profileId !== profileId) continue;
    const g = t.pinned ? undefined : inner.get(id);
    if (member ? !member(t) : !t.pinned && !g) continue;
    if (g) {
      for (const c of pinnedChain(s, g, ownIds)) {
        if (owned.has(c.id)) continue;
        owned.add(c.id);
        const key = pinKeyOf(c);
        if (x.groups.has(key)) x.duplicate = true;
        else {
          const p = c.parentId && ownIds.has(c.parentId) ? s.groups[c.parentId]! : undefined;
          x.groups.set(key, { group: c, parent: p ? pinKeyOf(p) : null });
        }
        x.own.push(c);
      }
    }
    x.items.push({ tab: t, group: g ? pinKeyOf(g) : null });
  }
  return x;
}

export function chainOf(x: Pick<Section, "groups">, key: string | null): string[] {
  const out: string[] = [];
  for (let k = key; k && x.groups.has(k) && !out.includes(k); k = x.groups.get(k)!.parent) out.unshift(k);
  return out;
}

const tileSig = (t: Tab) =>
  `${pinKeyOf(t)}\u0001${t.pinnedUrl ?? ""}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}\u0001${t.pinnedAsRow ? "r" : ""}\u0001${t.tileFolder?.id ?? ""}\u0001${t.tileFolder?.name ?? ""}\u0001${t.tileFolder?.renamedAt ?? ""}`;
const memberSig = (t: Tab) => `${pinKeyOf(t)}\u0001${t.pinnedUrl ?? ""}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}`;
export function signature(x: Section): string {
  const shown = new Set<string>();
  const lines: string[] = [];
  for (const { tab, group } of x.items) {
    for (const key of chainOf(x, group)) {
      if (shown.has(key)) continue;
      shown.add(key);
      const { group: g, parent } = x.groups.get(key)!;
      lines.push(`G${key}\u0001${g.name}\u0001${g.icon ?? ""}\u0001${g.color ?? ""}\u0001${parent ?? ""}`);
    }
    lines.push(group ? `${memberSig(tab)}\u0002${group}` : tileSig(tab));
  }
  if (x.splits) lines.push(...x.splits.map(splitSig).sort());
  return lines.join("\n");
}

export function profilesOf(s: Pick<BrowserState, "tabs">, w: BrowserWindow): Set<string> {
  const out = new Set<string>();
  for (const id of w.tabIds) {
    const p = s.tabs[id]?.profileId;
    if (p && !isIncognitoProfile(p)) out.add(p);
  }
  return out;
}

const pinnedGroupsOf = (s: Pick<BrowserState, "groups">) => Object.values(s.groups).filter((g) => g.pinned);

export function hasDuplicates(x: Section): boolean {
  const tabs = x.items.map((i) => pinKeyOf(i.tab));
  return !!x.duplicate || new Set(tabs).size < tabs.length;
}

const PIN_FIELDS = ["pinned", "pinnedUrl", "pinnedAsRow", "tileFolder", "customTitle", "customIcon", "profileId", "windowId", "pinKey"] as const;
function pinnedSplitsChanged(s: BrowserState, prev: BrowserState): boolean {
  if (s.splits === prev.splits) return false;
  const members = new Set(pinnedGroupsOf(s).flatMap((g) => g.tabIds));
  const pinnedPane = (id: string) => !!s.tabs[id]?.pinned || !!prev.tabs[id]?.pinned || members.has(id);
  return [...Object.values(s.splits), ...Object.values(prev.splits)].some((v) => v.tabIds.some(pinnedPane));
}

function pinsMayDiffer(s: BrowserState, prev: BrowserState): boolean {
  if (s.windows !== prev.windows || s.groups !== prev.groups || pinnedSplitsChanged(s, prev)) return true;
  if (s.tabs === prev.tabs) return false;
  let members: Set<string> | null = null;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) {
      if (a?.pinned || b?.pinned) return true;
      members ??= new Set(pinnedGroupsOf(s).flatMap((g) => g.tabIds));
      if (members.has(id)) return true;
      continue;
    }
    if (PIN_FIELDS.some((f) => a[f] !== b[f])) return true;
  }
  return false;
}

const lastIndex = <T>(xs: T[], test: (x: T) => boolean) => {
  for (let i = xs.length - 1; i >= 0; i--) if (test(xs[i]!)) return i;
  return -1;
};

export function union(sections: Section[], samePages = true): Section {
  const spec: Section = { items: [], groups: new Map(), own: [] };
  const keys = new Set<string>();
  const within = (item: Item, key: string) => chainOf(spec, item.group).includes(key);
  const lastIn = (key: string) => lastIndex(spec.items, (i) => within(i, key));
  for (const x of sections) {
    const earlier = spec.items.filter((i) => !i.group).map((i) => i.tab);
    const paired = new Set((x.splits ?? []).flatMap((v) => v.keys));
    for (const [key, g] of x.groups) if (!spec.groups.has(key)) spec.groups.set(key, g);
    let anchor = -1;
    for (const item of x.items) {
      const key = pinKeyOf(item.tab);
      if (keys.has(key)) {
        anchor = spec.items.findIndex((i) => pinKeyOf(i.tab) === key);
        continue;
      }
      if (samePages && !item.group && !paired.has(key) && earlier.some((o) => samePage(homeOf(o), homeOf(item.tab)))) continue;
      keys.add(key);
      const host = chainOf(spec, item.group).reverse().find((k) => lastIn(k) >= 0);
      const at = host
        ? anchor >= 0 && within(spec.items[anchor]!, host) ? anchor : lastIn(host)
        : anchor >= 0 ? anchor : item.group ? spec.items.length - 1 : lastIndex(spec.items, (i) => !i.group);
      spec.items.splice(at + 1, 0, item);
      anchor = at + 1;
    }
    if (x.splits) spec.splits ??= [];
    for (const v of x.splits ?? []) if (!spec.splits!.some((u) => u.keys.some((k) => v.keys.includes(k)))) spec.splits!.push(v);
  }
  return spec;
}

export function treeOrder(x: Pick<Section, "items" | "groups">): Item[] {
  const kids = new Map<string | null, (Item | string)[]>();
  const add = (parent: string | null, node: Item | string) => kids.set(parent, [...(kids.get(parent) ?? []), node]);
  const seen = new Set<string>();
  for (const item of x.items) {
    const chain = chainOf(x, item.group);
    add(chain.at(-1) ?? null, item);
    for (let i = chain.length - 1; i >= 0 && !seen.has(chain[i]!); i--) {
      seen.add(chain[i]!);
      add(chain[i - 1] ?? null, chain[i]!);
    }
  }
  const flat = (parent: string | null): Item[] => (kids.get(parent) ?? []).flatMap((n) => (typeof n === "string" ? flat(n) : [n]));
  return flat(null);
}

export const keyField = (id: string, key: string) => (id === key ? { pinKey: undefined } : { pinKey: key });

export function copyOf(src: Tab, windowId: string, tile: boolean): Tab {
  const url = tile ? homeOf(src) : src.url;
  const atSource = samePage(src.url, url);
  return {
    ...makeTab(windowId, src.profileId, url, {
      title: atSource ? src.title : "",
      favicon: atSource ? src.favicon : null,
      pinned: tile,
      pinnedUrl: src.pinnedUrl || (tile ? src.url : null) || null,
      ...(tile && src.pinnedAsRow ? { pinnedAsRow: true as const } : {}),
      ...(tile && !src.pinnedAsRow && src.tileFolder ? { tileFolder: src.tileFolder } : {}),
      customTitle: src.customTitle,
      customIcon: src.customIcon,
      muted: src.muted,
      zoom: src.zoom,
    }),
    pinKey: pinKeyOf(src),
    navigation: null,
    unloaded: true,
  };
}

function conform(s: BrowserState, windowId: string, profileId: string, spec: Section): BrowserState {
  const w = s.windows[windowId]!;
  const cur = sectionOf(s, w, profileId, pinnedGroupsOf(s));
  const mine = cur.items.map((i) => i.tab);
  const used = new Set<string>();
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  let groups = { ...s.groups };
  const wantedKeys = new Set(spec.items.map((i) => pinKeyOf(i.tab)));
  const byKey = new Map<string, Tab[]>();
  for (const m of mine) byKey.get(pinKeyOf(m))?.push(m) ?? byKey.set(pinKeyOf(m), [m]);
  const reuse = (src: Tab, tile: boolean): string => {
    const key = pinKeyOf(src);
    const same = (byKey.get(key) ?? []).filter((m) => !used.has(m.id));
    let t = same.find(hasPage) ?? same[0];
    if (!t && tile) t = mine.find((m) => m.pinned && !used.has(m.id) && !wantedKeys.has(pinKeyOf(m)) && samePage(homeOf(m), homeOf(src)));
    if (!t) {
      const copy = copyOf(src, windowId, tile);
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      used.add(copy.id);
      return copy.id;
    }
    used.add(t.id);
    const patch: Partial<Tab> = {
      ...keyField(t.id, key),
      pinned: tile,
      pinnedAsRow: tile && src.pinnedAsRow ? true : undefined,
      tileFolder: tile && !src.pinnedAsRow ? src.tileFolder : undefined,
      customTitle: src.customTitle,
      customIcon: src.customIcon,
    };
    patch.pinnedUrl = src.pinnedUrl || (tile ? src.url : null) || null;
    if (tile && !hasPage(t) && !samePage(t.url, homeOf(src))) Object.assign(patch, { url: homeOf(src), title: src.title, favicon: src.favicon });
    tabs[t.id] = { ...t, ...patch };
    return t.id;
  };
  const order = treeOrder(spec);
  const tiles = order.filter((i) => !i.group).map((i) => [i, reuse(i.tab, true)] as const);
  const members = order.filter((i) => i.group).map((i) => [i, reuse(i.tab, false)] as const);
  const local = new Map([...tiles, ...members]);
  const placedIds = order.map((i) => local.get(i)!);
  const within = new Map<string, string[]>();
  for (const i of order) for (const key of chainOf(spec, i.group)) within.get(key)?.push(local.get(i)!) ?? within.set(key, [local.get(i)!]);
  const usedGroups = new Set<string>();
  const groupIdOf = new Map<string, string>();
  for (const key of within.keys()) {
    const { group: src, parent } = spec.groups.get(key)!;
    const own = cur.own.find((g) => !usedGroups.has(g.id) && pinKeyOf(g) === key);
    const id = own?.id ?? newId("g");
    usedGroups.add(id);
    groupIdOf.set(key, id);
    const tabIds = within.get(key)!;
    const base: TabGroup = own ?? { id, windowId, profileId, name: "", icon: null, color: null, collapsed: src.collapsed, pinned: true, tabIds: [], createdAt: Date.now() };
    groups[id] = withParent({ ...base, ...keyField(id, key), name: src.name, icon: src.icon, color: src.color, pinned: true, tabIds }, parent ? groupIdOf.get(parent) : undefined);
  }

  const shown = new Set(Object.values(w.activeTabIds));
  const leaving = mine.filter((t) => !used.has(t.id));
  const demoted = leaving.filter((t) => hasPage(t) || shown.has(t.id)).map((t) => t.id);
  const stays = new Set(demoted);
  const gone = leaving.filter((t) => !stays.has(t.id)).map((t) => t.id);
  for (const id of demoted) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinnedAsRow: undefined, tileFolder: undefined, pinKey: undefined };
  const kept = new Set<string>();
  for (const group of cur.own) {
    if (usedGroups.has(group.id)) continue;
    const left = group.tabIds.filter((id) => stays.has(id));
    if (left.length) (groups[group.id] = { ...group, pinned: false, pinKey: undefined, tabIds: left }), kept.add(group.id);
    else delete groups[group.id];
  }
  for (const id of kept) if (groups[id]!.parentId && !kept.has(groups[id]!.parentId!)) groups[id] = withParent(groups[id]!, undefined);

  const section = new Set([...mine.map((t) => t.id), ...placedIds]);
  let ids = [...placedIds, ...demoted, ...w.tabIds.filter((id) => !section.has(id))];
  let splits = s.splits;
  if (spec.splits) {
    const paneOf = new Map([...tiles, ...members].filter(([i]) => !isTile(i.tab)).map(([i, id]) => [pinKeyOf(i.tab), id]));
    const panes = new Set(paneOf.values());
    const wanted = spec.splits.map((v) => ({ ...v, ids: v.keys.map((k) => paneOf.get(k) ?? "") })).filter((v) => v.ids.every(Boolean));
    const same = (v: SplitView, x: (typeof wanted)[number]) => v.tabIds.join() === x.ids.join() && v.orientation === x.orientation && v.stack?.index === x.stack?.index;
    const stale = Object.values(splits).filter((v) => v.windowId === windowId && v.tabIds.every((id) => panes.has(id)) && !wanted.some((x) => same(v, x)));
    if (stale.length) splits = without(splits, stale.map((v) => v.id));
    for (const x of wanted) {
      if (!Object.values(splits).some((v) => same(v, x))) {
        const id = newId("split");
        splits = { ...removeFromSplits(splits, new Set(x.ids)), [id]: { id, windowId, tabIds: x.ids, orientation: x.orientation, sizes: x.sizes, ...(x.stack ? { stack: x.stack } : {}) } };
      }
      ids = placeBlock(ids, ids.filter((id) => x.ids.includes(id)));
    }
  }
  const window = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs, groups), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  const next: BrowserState = { ...s, tabs, live, groups, splits, windows: { ...s.windows, [windowId]: window } };
  return gone.length ? removeTabs(next, gone, false) : next;
}

export function mirrorPins(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (!pinsMayDiffer(s, prev)) return null;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => mirrored(s.windows[id]));
  const byProfile = new Map<string, string[]>();
  for (const id of order) for (const p of profilesOf(s, s.windows[id]!)) byProfile.set(p, [...(byProfile.get(p) ?? []), id]);
  let next = s;
  for (const [profileId, ids] of byProfile) {
    for (const id of ids) {
      const x = withSplits(next, next.windows[id]!, sectionOf(next, next.windows[id]!, profileId, pinnedGroupsOf(next)));
      if (hasDuplicates(x)) next = conform(next, id, profileId, union([x]));
    }
  }
  const nowGroups = pinnedGroupsOf(next);
  const prevGroups = pinnedGroupsOf(prev);
  for (const [profileId, ids] of byProfile) {
    if (ids.length < 2) continue;
    const sections = new Map(ids.map((id) => [id, withSplits(next, next.windows[id]!, sectionOf(next, next.windows[id]!, profileId, nowGroups))]));
    const sigs = new Map(ids.map((id) => [id, signature(sections.get(id)!)]));
    if (new Set(sigs.values()).size === 1) continue;
    const before = ids.filter((id) => mirrored(prev.windows[id]) && profilesOf(prev, prev.windows[id]!).has(profileId));
    const source = before.find((id) => signature(withSplits(prev, prev.windows[id]!, sectionOf(prev, prev.windows[id]!, profileId, prevGroups))) !== sigs.get(id));
    const spec: Section = source
      ? sections.get(source)!
      : union([...before, ...ids.filter((id) => !before.includes(id))].map((id) => sections.get(id)!));
    const want = source ? sigs.get(source)! : null;
    for (const id of ids) {
      if (id === source || (want !== null && sigs.get(id) === want) || !next.windows[id]) continue;
      next = conform(next, id, profileId, spec);
    }
  }
  return next === s ? null : next;
}

export function settleMovedPins(before: BrowserState, after: BrowserState, moved: string[], targetId: string): BrowserState {
  if (!mirrored(after.windows[targetId])) return after;
  const memberOf = innermostPinned(before, pinnedGroupsOf(before));
  const pins = moved
    .map((id) => before.tabs[id])
    .filter((t): t is Tab => !!t && (t.pinned || memberOf.has(t.id) || sharedListTab(before, t)) && t.windowId !== targetId && after.tabs[t.id]?.windowId === targetId);
  if (!pins.length) return after;
  const tabs = { ...after.tabs };
  const live = { ...after.live };
  const windows = { ...after.windows };
  const groups = { ...after.groups };
  for (const sourceId of new Set(pins.map((t) => t.windowId))) {
    const src = windows[sourceId];
    if (!mirrored(src) || !mirrored(before.windows[sourceId])) continue;
    const swap = new Map<string, string>();
    const shown = before.windows[sourceId]!.activeTabIds;
    let activeTabIds = src.activeTabIds;
    for (const t of pins) {
      if (t.windowId !== sourceId) continue;
      const copy = copyOf(t, sourceId, t.pinned);
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      swap.set(t.id, copy.id);
      if (shown[t.profileId] === t.id && !t.pinned && !memberOf.has(t.id)) activeTabIds = { ...activeTabIds, [t.profileId]: copy.id };
    }
    const present = new Set([...src.tabIds, ...swap.values()]);
    const keep = (ids: string[]) => ids.map((id) => swap.get(id) ?? id).filter((id) => present.has(id));
    for (const g of sharesTabs(before) ? Object.values(before.groups) : pinnedGroupsOf(before)) {
      if (g.windowId === sourceId && g.tabIds.some((id) => swap.has(id))) groups[g.id] = { ...g, ...groups[g.id], tabIds: keep(g.tabIds) };
    }
    windows[sourceId] = { ...src, tabIds: pinnedFirst(keep(before.windows[sourceId]!.tabIds), tabs, groups), ...(activeTabIds !== src.activeTabIds ? { activeTabIds } : {}) };
  }
  const target = windows[targetId]!;
  let tabIds = [...target.tabIds];
  const gone: string[] = [];
  for (const m of pins) {
    const g = memberOf.get(m.id);
    if (!g) continue;
    const own = Object.values(groups).find((x) => x.pinned && x.windowId === targetId && x.profileId === m.profileId && pinKeyOf(x) === pinKeyOf(g));
    const copy = own?.tabIds.find((id) => tabs[id] && pinKeyOf(tabs[id]!) === pinKeyOf(m));
    if (!own || !copy) continue;
    for (const x of Object.values(groups)) if (x.windowId === targetId && x.tabIds.includes(copy)) groups[x.id] = { ...x, tabIds: x.tabIds.map((id) => (id === copy ? m.id : id)) };
    tabIds = tabIds.filter((id) => id !== m.id);
    tabIds[tabIds.indexOf(copy)] = m.id;
    if (hasPage(tabs[copy]!) || Object.values(target.activeTabIds).includes(copy)) {
      tabs[copy] = { ...tabs[copy]!, pinKey: undefined };
      tabIds.push(copy);
    } else gone.push(copy);
  }
  windows[targetId] = { ...target, tabIds: orderSections(pinnedFirst(tabIds, tabs, groups), tabs, groups) };
  const next: BrowserState = { ...after, tabs, live, windows, groups };
  return gone.length ? removeTabs(next, gone, false) : next;
}
