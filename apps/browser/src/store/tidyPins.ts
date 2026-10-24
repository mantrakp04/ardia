import type { BrowserState } from "./browser";
import { siteKey, siteName } from "./groupNames";
import { depthOf, innermostGroupOf } from "./groups";
import { activeTabId, isPinnedRow } from "./model";
import { placing, restoreSnapshots, samePage, withRowsGrouped } from "./organize";
import { splitOf, splitRowPanes, withSplitRows } from "./splits";
import { activated, apply, removeTabs } from "./tabs";
import type { ClosedTab, Tab, TabGroup } from "./types";

export type TidyPlan = {
  closes: { tabId: string; keeperId: string }[];
  files: { tabId: string; groupId: string }[];
  newGroups: { tabIds: string[]; name: string }[];
};

export type TidiedPins = {
  windowId: string;
  order: string[];
  homes: Record<string, string | null>;
  closed: ClosedTab[];
  pins: number;
  folders: number;
  duplicates: number;
};

const homeOf = (t: Pick<Tab, "url" | "pinnedUrl">) => t.pinnedUrl || t.url;

function foldersOf(s: Pick<BrowserState, "groups">, order: string[], windowId: string, profileId: string): TabGroup[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return Object.values(s.groups)
    .filter((g) => g.pinned && g.windowId === windowId && g.profileId === profileId && g.tabIds.length)
    .map((g) => ({ g, top: Math.min(...g.tabIds.map((id) => at.get(id) ?? Infinity)), depth: depthOf(s.groups, g.id) }))
    .sort((a, z) => a.top - z.top || a.depth - z.depth)
    .map(({ g }) => g);
}

function folderSites(s: Pick<BrowserState, "tabs" | "groups">, g: TabGroup): string[] {
  const direct = g.tabIds.filter((id) => innermostGroupOf(s.groups, id)?.id === g.id && s.tabs[id]);
  const counts = new Map<string, number>();
  for (const id of direct) {
    const site = siteKey(homeOf(s.tabs[id]!));
    if (site) counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  const most = Math.max(0, ...counts.values());
  if (!most || most * 2 < direct.length) return [];
  return [...counts].filter(([, n]) => n === most).map(([site]) => site);
}

export function tidyPlan(s: Pick<BrowserState, "tabs" | "groups" | "windows" | "splits">, windowId: string, profileId?: string): TidyPlan | null {
  const w = s.windows[windowId];
  if (!w || w.incognito || w.kind === "small") return null;
  const profile = profileId ?? w.profileId;
  const order = w.tabIds.filter((id) => s.tabs[id]?.profileId === profile);
  const rows = order.filter((id) => isPinnedRow(s.tabs[id]));
  if (!rows.length) return null;
  const folders = foldersOf(s, order, w.id, profile);
  const filed = [...new Set(folders.flatMap((g) => g.tabIds))].flatMap((id) => (s.tabs[id] ? [s.tabs[id]!] : []));

  const closes: TidyPlan["closes"] = [];
  const kept: Tab[] = [];
  for (const id of rows) {
    const t = s.tabs[id]!;
    const home = homeOf(t);
    const inSplitRow = splitRowPanes(s, splitOf(s, id)).includes(id);
    const twin = home && !inSplitRow ? (filed.find((f) => homeOf(f) && samePage(homeOf(f), home)) ?? kept.find((k) => samePage(homeOf(k), home))) : undefined;
    if (twin) closes.push({ tabId: id, keeperId: twin.id });
    else kept.push(t);
  }

  const folderFor = new Map<string, string>();
  for (const g of folders) for (const site of folderSites(s, g)) if (!folderFor.has(site)) folderFor.set(site, g.id);
  const files: TidyPlan["files"] = [];
  const loose = new Map<string, Tab[]>();
  for (const t of kept) {
    const site = siteKey(homeOf(t));
    if (!site) continue;
    const groupId = folderFor.get(site);
    if (groupId) files.push({ tabId: t.id, groupId });
    else loose.set(site, [...(loose.get(site) ?? []), t]);
  }

  const newGroups = [...loose.values()]
    .filter((same) => same.length >= 2)
    .map((same) => ({ tabIds: same.map((t) => t.id), name: siteName(same.map((t) => ({ url: homeOf(t), title: t.title }))) }));

  return closes.length || files.length || newGroups.length ? { closes, files, newGroups } : null;
}

const plans = new Map<string, { tabs: object; groups: object; splits: object; window: object | undefined; can: boolean }>();

export function canTidyPins(s: Pick<BrowserState, "tabs" | "groups" | "windows" | "splits">, windowId: string, profileId?: string): boolean {
  const key = `${windowId}\n${profileId ?? ""}`;
  const window = s.windows[windowId];
  const known = plans.get(key);
  if (known && known.tabs === s.tabs && known.groups === s.groups && known.splits === s.splits && known.window === window) return known.can;
  const can = !!tidyPlan(s, windowId, profileId);
  plans.set(key, { tabs: s.tabs, groups: s.groups, splits: s.splits, window, can });
  if (plans.size > 64) plans.delete(plans.keys().next().value!);
  return can;
}

export function tidyingPins(s: BrowserState, windowId: string, profileId?: string): [BrowserState, TidiedPins | null] {
  const plan = tidyPlan(s, windowId, profileId);
  const w = s.windows[windowId];
  if (!plan || !w) return [s, null];
  const homes: Record<string, string | null> = {};
  for (const id of withSplitRows(s, [...plan.files.map((f) => f.tabId), ...plan.newGroups.flatMap((g) => g.tabIds)])) homes[id] = s.tabs[id]!.pinnedUrl;
  let next = s;
  let closed: ClosedTab[] = [];
  if (plan.closes.length) {
    const ids = new Set(plan.closes.map((c) => c.tabId));
    const shown = activeTabId(s, windowId);
    next = removeTabs(next, [...ids], true);
    closed = next.closedTabs.filter((c) => !s.closedTabs.includes(c) && !!c.tabId && ids.has(c.tabId));
    const keeper = shown && ids.has(shown) ? plan.closes.find((c) => c.tabId === shown)!.keeperId : undefined;
    if (keeper && next.tabs[keeper]) next = apply(next, activated(next, keeper));
  }
  for (const f of plan.files) next = placing(next, [f.tabId], { pinned: false, groupId: f.groupId });
  for (const g of plan.newGroups) next = withRowsGrouped(next, g.tabIds, { pinned: true, name: g.name })[0];
  const pins = Object.keys(homes).length;
  const folders = new Set(plan.files.map((f) => f.groupId)).size + plan.newGroups.length;
  return [next, { windowId, order: [...w.tabIds], homes, closed, pins, folders, duplicates: plan.closes.length }];
}

export function untidyingPins(s: BrowserState, tidied: TidiedPins): BrowserState {
  const w = s.windows[tidied.windowId];
  if (!w) return s;
  const gone = new Set(tidied.closed.map((c) => c.id));
  let next: BrowserState = { ...s, closedTabs: s.closedTabs.filter((c) => !gone.has(c.id)) };
  const now = new Map<string, string>();
  for (const id of Object.keys(tidied.homes)) if (next.tabs[id]?.windowId === w.id) now.set(id, id);
  const back = tidied.closed.filter((e) => !next.tabs[e.tabId ?? ""]);
  const [restored, ids] = restoreSnapshots(next, w.id, back.map((e) => ({ tab: e.tab, tabId: e.restoreFrom ?? e.tabId, index: e.index })));
  next = restored;
  back.forEach((e, i) => ids[i] && e.tabId && now.set(e.tabId, ids[i]!));
  const inWindow = (id: string) => next.tabs[id]?.windowId === w.id;
  const returning = tidied.order.filter((id) => now.has(id)).reverse();
  const placed = new Set<string>();
  for (const id of returning) {
    const tabId = now.get(id)!;
    if (placed.has(tabId)) continue;
    const block = new Set(withSplitRows(next, [tabId]));
    const later = tidied.order.slice(tidied.order.indexOf(id) + 1).map((o) => now.get(o) ?? o);
    const beforeId = later.find((o) => inWindow(o) && !block.has(o)) ?? null;
    next = placing(next, [tabId], { pinned: true, row: true, beforeId, last: !beforeId });
    block.forEach((pane) => placed.add(pane));
  }
  for (const [id, tabId] of now) {
    const home = tidied.homes[id];
    if (id in tidied.homes && home && next.tabs[tabId]) next = { ...next, tabs: { ...next.tabs, [tabId]: { ...next.tabs[tabId]!, pinnedUrl: home } } };
  }
  return next;
}
