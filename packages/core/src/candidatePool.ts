import { logVisits, pageText, pageTexts, type PageText } from "./pageText.ts";
import type { SuggestionSource } from "./suggestion.ts";

type HistoryRow = SuggestionSource["history"][number];
type BookmarkRow = NonNullable<SuggestionSource["bookmarks"]>[number];
type TabRow = SuggestionSource["tabs"][number];

export type Candidate = {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  lastVisit: number;
  logVisits: number;
  bookmarked: boolean;
  tabId?: string;
  fresh?: boolean;
  text: PageText;
};

type Lookup = { get(key: string): Candidate | undefined; has(key: string): boolean };
export type Pool = { list: Candidate[]; byKey: Lookup; initials: Map<string, Candidate[]> | null };

type BookmarkBase = { list: Candidate[]; byKey: Map<string, Candidate>; cursor: number; done: boolean };
type Builder = {
  base: BookmarkBase;
  history: readonly HistoryRow[];
  list: Candidate[];
  byKey: Map<string, Candidate>;
  historyCursor: number;
  bookmarkCursor: number;
  initials: Map<string, Candidate[]>;
  initialsCursor: number;
  pool: Pool | null;
};

const bases = new WeakMap<readonly BookmarkRow[], BookmarkBase>();
const builders = new WeakMap<readonly HistoryRow[], WeakMap<readonly BookmarkRow[], Builder>>();
export const NO_BOOKMARKS: readonly BookmarkRow[] = [];
const historyCandidates = new WeakMap<HistoryRow, Candidate>();
const SLICE_CHECK = 64;

function baseFor(bookmarks: readonly BookmarkRow[]): BookmarkBase {
  let base = bases.get(bookmarks);
  if (!base) bases.set(bookmarks, (base = { list: [], byKey: new Map(), cursor: 0, done: false }));
  return base;
}

function advance(b: Builder, bookmarks: readonly BookmarkRow[], deadline: number): boolean {
  if (b.pool) return true;
  let n = 0;
  const late = () => ++n % SLICE_CHECK === 0 && Date.now() > deadline;
  const base = b.base;
  while (!base.done && base.cursor < bookmarks.length) {
    const row = bookmarks[base.cursor++]!;
    const text = pageText(row);
    if (!base.byKey.has(text.key)) {
      const c: Candidate = { url: row.url, title: row.title, favicon: row.favicon, visits: 0, lastVisit: 0, logVisits: 0, bookmarked: true, text };
      base.list.push(c);
      base.byKey.set(text.key, c);
    }
    if (late()) return false;
  }
  base.done = true;
  while (b.historyCursor < b.history.length) {
    const h = b.history[b.historyCursor++]!;
    const text = pageText(h);
    if (!b.byKey.has(text.key)) {
      const bookmarked = base.byKey.has(text.key);
      let c = historyCandidates.get(h);
      if (!c || c.bookmarked !== bookmarked) {
        c = { url: h.url, title: h.title, favicon: h.favicon, visits: h.visits, lastVisit: h.lastVisit, logVisits: logVisits(h.visits), bookmarked, text };
        historyCandidates.set(h, c);
      }
      b.list.push(c);
      b.byKey.set(text.key, c);
    }
    if (late()) return false;
  }
  while (b.bookmarkCursor < base.list.length) {
    const c = base.list[b.bookmarkCursor++]!;
    if (!b.byKey.has(c.text.key)) b.list.push(c);
    if (late()) return false;
  }
  const history = b.byKey;
  b.pool = {
    list: b.list,
    byKey: { get: (key) => history.get(key) ?? base.byKey.get(key), has: (key) => history.has(key) || base.byKey.has(key) },
    initials: null,
  };
  return true;
}

function builderFor(history: readonly HistoryRow[], bookmarks: readonly BookmarkRow[]): Builder {
  let byBookmarks = builders.get(history);
  if (!byBookmarks) builders.set(history, (byBookmarks = new WeakMap()));
  let b = byBookmarks.get(bookmarks);
  if (!b) byBookmarks.set(bookmarks, (b = { base: baseFor(bookmarks), history, list: [], byKey: new Map(), historyCursor: 0, bookmarkCursor: 0, initials: new Map(), initialsCursor: 0, pool: null }));
  return b;
}

export function poolFor(history: readonly HistoryRow[], bookmarks: readonly BookmarkRow[]): Pool {
  const b = builderFor(history, bookmarks);
  advance(b, bookmarks, Infinity);
  indexInitials(b, Infinity);
  return b.pool!;
}

function indexInitials(b: Builder, deadline: number): boolean {
  const pool = b.pool!;
  if (pool.initials) return true;
  let n = 0;
  while (b.initialsCursor < pool.list.length) {
    const candidate = pool.list[b.initialsCursor++]!;
    const shown = candidate.text.shownLower;
    const title = candidate.text.titleLower;
    const chars = new Set<string>();
    if (/^[a-z0-9]/.test(shown)) chars.add(shown[0]!);
    if (/^[a-z0-9]/.test(title)) chars.add(title[0]!);
    for (let i = 1; i < shown.length; i++) {
      if (shown[i - 1] === "." || shown[i - 1] === "/") chars.add(shown[i]!);
    }
    for (const word of candidate.text.titleWords.split(" ")) if (word) chars.add(word[0]!);
    for (const char of chars) {
      const rows = b.initials.get(char);
      if (rows) rows.push(candidate);
      else b.initials.set(char, [candidate]);
    }
    if (++n % SLICE_CHECK === 0 && Date.now() > deadline) return false;
  }
  pool.initials = b.initials;
  return true;
}

export function prepareSuggestions(source: SuggestionSource, deadline: number): boolean {
  const bookmarks = source.bookmarks ?? NO_BOOKMARKS;
  const b = builderFor(source.history, bookmarks);
  if (b.pool) return indexInitials(b, deadline);
  for (const rows of [source.history, bookmarks]) {
    let n = 0;
    for (const row of rows) {
      if (pageTexts.has(row)) continue;
      pageText(row);
      if (++n % SLICE_CHECK === 0 && Date.now() > deadline) return false;
    }
  }
  const ready = advance(b, bookmarks, deadline);
  return ready && indexInitials(b, deadline);
}

type TabsOver = { pool: Pool; currentTabId: string | undefined; rows: TabRow[]; tabIds: Map<string, string>; extra: Candidate[] };
const tabsOverCache = new WeakMap<readonly TabRow[], TabsOver>();

export function tabsOver(pool: Pool, tabs: readonly TabRow[], currentTabId?: string): TabsOver {
  const cached = tabsOverCache.get(tabs);
  if (cached && cached.pool === pool && cached.currentTabId === currentTabId && cached.rows.length === tabs.length) {
    let same = true;
    for (let i = 0; same && i < tabs.length; i++) same = cached.rows[i] === tabs[i];
    if (same) return cached;
  }
  const tabIds = new Map<string, string>();
  const extra: Candidate[] = [];
  for (const t of tabs) {
    if (!t.url || t.id === currentTabId) continue;
    const text = pageText(t);
    if (tabIds.has(text.key)) continue;
    tabIds.set(text.key, t.id);
    if (!pool.byKey.has(text.key)) extra.push({ url: t.url, title: t.title, favicon: t.favicon, visits: 0, lastVisit: 0, logVisits: 0, fresh: true, bookmarked: false, tabId: t.id, text });
  }
  const result = { pool, currentTabId, rows: tabs.slice(), tabIds, extra };
  tabsOverCache.set(tabs, result);
  return result;
}
