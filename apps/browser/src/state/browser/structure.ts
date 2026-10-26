import type { SplitView, TabGroup } from "./types";

const groupIndexes = new WeakMap<Record<string, TabGroup>, Map<string, TabGroup>>();
const splitIndexes = new WeakMap<Record<string, SplitView>, Map<string, SplitView[]>>();

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
      for (const id of v.tabIds) {
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

export function stableList(previous: string[] | undefined, next: string[]): string[] {
  return previous && same(previous, next) ? previous : next;
}
