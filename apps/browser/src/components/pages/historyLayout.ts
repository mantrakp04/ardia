import type { HistoryEntry } from "../../state/browser/types";
import { dayLabel, dayStart, queryWords, searchText } from "./PageLayout";
import { historyRow } from "./tokens";

const ROW = historyRow.height;
const HEADER = historyRow.header;

export const historyScroll = { lastAt: 0 };

export type Day = { label: string; offset: number };
export type Row = { entry: HistoryEntry; day: number; first: boolean; last: boolean; offset: number };
export type Layout = { days: Day[]; rows: Row[]; height: number };

const searchTexts = new WeakMap<HistoryEntry, string>();
function searchTextOf(entry: HistoryEntry) {
  let text = searchTexts.get(entry);
  if (text === undefined) searchTexts.set(entry, (text = searchText(entry.title, entry.url)));
  return text;
}

export function layoutHistory(history: HistoryEntry[], query: string): Layout {
  const words = queryWords(query);
  const days: Day[] = [];
  const rows: Row[] = [];
  let offset = 0;
  let from = Infinity;
  let to = -Infinity;
  for (const entry of history) {
    if (words.length) {
      const text = searchTextOf(entry);
      if (!words.every((w) => text.includes(w))) continue;
    }
    const first = entry.lastVisit < from || entry.lastVisit >= to;
    if (first) {
      from = dayStart(entry.lastVisit);
      const d = new Date(from);
      to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      if (rows.length) rows[rows.length - 1]!.last = true;
      days.push({ label: dayLabel(from), offset });
      offset += HEADER;
    }
    rows.push({ entry, day: days.length - 1, first, last: false, offset });
    offset += ROW;
  }
  if (rows.length) rows[rows.length - 1]!.last = true;
  return { days, rows, height: offset };
}

export function assignSlots(keys: string[], previous: Map<string, number>) {
  const next = new Map<string, number>();
  const taken = new Set<number>();
  for (const key of keys) {
    const slot = previous.get(key);
    if (slot !== undefined && slot < keys.length && !taken.has(slot) && !next.has(key)) {
      next.set(key, slot);
      taken.add(slot);
    }
  }
  let free = 0;
  for (const key of keys) {
    if (next.has(key)) continue;
    while (taken.has(free)) free++;
    next.set(key, free);
    taken.add(free);
  }
  return next;
}

export function rowAt(rows: Row[], y: number) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.offset + ROW > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
