import type { BrowserState } from "../../store/browser";
import { activeTabId, viewTabIds } from "../../store/model";
import { hiddenEmptyCard } from "../../store/newTabBar";
import { splitRowPanes } from "../../store/splits";
import { splitIndex, stableList } from "../../store/structure";
import { tileCells } from "../../store/tileFolders";

type SidebarEntries = { tiles: string[]; cells: string[]; pinned: string[]; list: string[] };

const memo = new Map<string, { inputs: unknown[]; result: SidebarEntries }>();

export function sidebarEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  const inputs = [s.tabs, s.windows, s.groups, s.splits, s.settings.newTabOpens];
  const key = profileId ? `${windowId}|${profileId}` : windowId;
  const cached = memo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  let result = computeEntries(s, windowId, profileId);
  if (cached) {
    const was = cached.result;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    const tiles = same(result.tiles, was.tiles) ? was.tiles : result.tiles;
    const cells = same(result.cells, was.cells) ? was.cells : result.cells;
    const pinned = same(result.pinned, was.pinned) ? was.pinned : result.pinned;
    const list = same(result.list, was.list) ? was.list : result.list;
    result = tiles === was.tiles && cells === was.cells && pinned === was.pinned && list === was.list ? was : { tiles, cells, pinned, list };
  }
  memo.set(key, { inputs, result });
  if (memo.size > 8) for (const k of memo.keys()) if (!s.windows[k.split("|")[0]!]) memo.delete(k);
  return result;
}

function computeEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  const tiles: string[] = [];
  const pinned: string[] = [];
  const list: string[] = [];
  const groupOf = new Map<string, string>();
  for (const g of Object.values(s.groups)) if (g.windowId === windowId && !g.parentId) g.tabIds.forEach((id) => groupOf.set(id, g.id));
  const splits = splitIndex(s.splits);
  const seen = new Set<string>();
  for (const id of viewTabIds(s, windowId, profileId)) {
    const tab = s.tabs[id]!;
    if ((tab.liveItem && !tab.pinned) || hiddenEmptyCard(s, tab)) continue;
    if (tab.pinned) {
      if (!tab.pinnedAsRow) tiles.push(id);
      else {
        const entry = pinnedRowEntry(s, id, splits);
        if (!seen.has(entry)) pinned.push(entry);
        seen.add(entry);
      }
      continue;
    }
    const groupId = groupOf.get(id);
    const entry = groupId ? `g:${groupId}` : splitEntry(s, id, splits);
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (groupId && s.groups[groupId]!.pinned) pinned.push(entry);
    else list.push(entry);
  }
  return { tiles, cells: tileCells(s.tabs, tiles), pinned, list };
}

export function numberedTabs(s: BrowserState, windowId: string): string[] {
  const { tiles, pinned, list } = sidebarEntries(s, windowId);
  const active = activeTabId(s, windowId);
  const rowTab = (entry: string): string[] => {
    const id = entry.slice(2);
    if (entry.startsWith("g:")) return groupEntries(s, id).flatMap(rowTab);
    if (!entry.startsWith("s:")) return [id];
    const panes = splitRowPanes(s, s.splits[id]);
    if (active && panes.includes(active)) return [active];
    const last = panes.reduce<string | undefined>((a, b) => (!a || s.tabs[b]!.lastActiveAt > s.tabs[a]!.lastActiveAt ? b : a), undefined);
    return last ? [last] : [];
  };
  return [...tiles, ...pinned.flatMap(rowTab), ...list.flatMap(rowTab)];
}

const groupMemo = new WeakMap<object, { tabs: BrowserState["tabs"]; splits: BrowserState["splits"]; groups: BrowserState["groups"]; result: string[] }>();

const childIndex = new WeakMap<object, Map<string, BrowserState["groups"][string][]>>();
const NO_CHILDREN: BrowserState["groups"][string][] = [];

function childGroups(groups: BrowserState["groups"], parentId: string): BrowserState["groups"][string][] {
  let index = childIndex.get(groups);
  if (!index) {
    index = new Map();
    for (const g of Object.values(groups)) {
      if (!g.parentId) continue;
      const siblings = index.get(g.parentId);
      if (siblings) siblings.push(g);
      else index.set(g.parentId, [g]);
    }
    childIndex.set(groups, index);
  }
  return index.get(parentId) ?? NO_CHILDREN;
}

export function groupEntries(s: BrowserState, groupId: string): string[] {
  const g = s.groups[groupId];
  if (!g) return [];
  const cached = groupMemo.get(g);
  if (cached && cached.tabs === s.tabs && cached.splits === s.splits && cached.groups === s.groups) return cached.result;
  const splits = splitIndex(s.splits);
  const childOf = new Map<string, string>();
  for (const c of childGroups(s.groups, groupId)) for (const id of c.tabIds) childOf.set(id, c.id);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of g.tabIds) {
    const child = childOf.get(id);
    const entry = child ? `g:${child}` : splitEntry(s, id, splits);
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  const result = stableList(cached?.result, out);
  groupMemo.set(g, { tabs: s.tabs, splits: s.splits, groups: s.groups, result });
  return result;
}

function pinnedRowEntry(s: BrowserState, tabId: string, splits: ReturnType<typeof splitIndex>): string {
  for (const v of splits.get(tabId) ?? []) if (splitRowPanes(s, v).includes(tabId)) return `s:${v.id}`;
  return `t:${tabId}`;
}

function splitEntry(s: BrowserState, tabId: string, splits = splitIndex(s.splits)): string {
  for (const v of splits.get(tabId) ?? []) {
    if (v.tabIds.filter((id) => s.tabs[id] && !s.tabs[id]!.pinned).length >= 2) return `s:${v.id}`;
  }
  return `t:${tabId}`;
}
