import type { BrowserState } from "./store";
import type { SplitView, Tab, TabGroup } from "./types";
import { splitTabIds } from "../splits/splits";
import { changedIds } from "./changes";

const groupIndexes = new WeakMap<Record<string, TabGroup>, Map<string, TabGroup>>();
const splitIndexes = new WeakMap<Record<string, SplitView>, Map<string, SplitView[]>>();
const pinnedMemberSets = new WeakMap<Record<string, TabGroup>, ReadonlySet<string>>();

export function pinnedGroupMembers(groups: Record<string, TabGroup>): ReadonlySet<string> {
  let members = pinnedMemberSets.get(groups);
  if (!members) {
    const ids = new Set<string>();
    for (const g of Object.values(groups)) if (g.pinned) for (const id of g.tabIds) ids.add(id);
    pinnedMemberSets.set(groups, (members = ids));
  }
  return members;
}

export function groupIndex(groups: Record<string, TabGroup>): Map<string, TabGroup> {
  let index = groupIndexes.get(groups);
  if (!index) {
    index = new Map();
    for (const g of Object.values(groups)) if (!g.parentId) for (const id of g.tabIds) if (!index.has(id)) index.set(id, g);
    groupIndexes.set(groups, index);
  }
  return index;
}

export function splitIndex(splits: Record<string, SplitView>): Map<string, SplitView[]> {
  let index = splitIndexes.get(splits);
  if (!index) {
    index = new Map();
    for (const v of Object.values(splits)) {
      for (const id of splitTabIds(v)) {
        const list = index.get(id);
        if (!list) index.set(id, [v]);
        else if (!list.includes(v)) list.push(v);
      }
    }
    splitIndexes.set(splits, index);
  }
  return index;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function onlyHiddenTabTitles(s: Pick<BrowserState, "tabs" | "windows" | "peeks">, prev: Pick<BrowserState, "tabs" | "windows" | "peeks">): boolean {
  if (s.windows !== prev.windows || s.peeks !== prev.peeks) return false;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) return false;
    const keys = Object.keys(a) as (keyof Tab)[];
    if (keys.length !== Object.keys(b).length || keys.some((k) => k !== "title" && k !== "favicon" && a[k] !== b[k])) return false;
    const w = s.windows[a.windowId];
    if ((w && Object.values(w.activeTabIds).includes(id)) || s.peeks[a.windowId]?.tabId === id) return false;
  }
  return true;
}

export function stableList(previous: string[] | undefined, next: string[]): string[] {
  return previous && same(previous, next) ? previous : next;
}
