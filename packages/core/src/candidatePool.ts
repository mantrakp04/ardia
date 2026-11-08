import { logVisits, pageText, pageTexts, tabPageText, type PageText } from "./pageText.ts";
import type { SuggestionSource } from "./suggestion.ts";

type HistoryRow = SuggestionSource["history"][number];
type BookmarkRow = NonNullable<SuggestionSource["bookmarks"]>[number];
type TabRow = SuggestionSource["tabs"][number];

export type Candidate = {
  url: string;
  title: string;
  pageTitle?: string;
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
export type Pool = { list: Candidate[]; byKey: Lookup };

type BookmarkBase = { list: Candidate[]; byKey: Map<string, Candidate>; keys: Set<string>; cursor: number; done: boolean };
type Builder = {
  base: BookmarkBase;
  history: readonly HistoryRow[];
  list: Candidate[];
  byKey: Map<string, Candidate>;
  historyCursor: number;
  bookmarkCursor: number;
  pool: Pool | null;
};

const bases = new WeakMap<readonly BookmarkRow[], BookmarkBase>();
const builders = new WeakMap<readonly HistoryRow[], WeakMap<readonly BookmarkRow[], Builder>>();
export const NO_BOOKMARKS: readonly BookmarkRow[] = [];
const historyCandidates = new WeakMap<HistoryRow, Candidate>();
const SLICE_CHECK = 64;

function baseFor(bookmarks: readonly BookmarkRow[]): BookmarkBase {
  let base = bases.get(bookmarks);
  if (!base) bases.set(bookmarks, (base = { list: [], byKey: new Map(), keys: new Set(), cursor: 0, done: false }));
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
    base.keys.add(text.key);
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
      const bookmarked = base.keys.has(text.key);
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
  };
  return true;
}

function builderFor(history: readonly HistoryRow[], bookmarks: readonly BookmarkRow[]): Builder {
  let byBookmarks = builders.get(history);
  if (!byBookmarks) builders.set(history, (byBookmarks = new WeakMap()));
  let b = byBookmarks.get(bookmarks);
  if (!b) byBookmarks.set(bookmarks, (b = { base: baseFor(bookmarks), history, list: [], byKey: new Map(), historyCursor: 0, bookmarkCursor: 0, pool: null }));
  return b;
}

export function poolFor(history: readonly HistoryRow[], bookmarks: readonly BookmarkRow[]): Pool {
  const b = builderFor(history, bookmarks);
  advance(b, bookmarks, Infinity);
  return b.pool!;
}

export function prepareSuggestions(source: SuggestionSource, deadline: number): boolean {
  const bookmarks = source.bookmarks ?? NO_BOOKMARKS;
  const b = builderFor(source.history, bookmarks);
  if (b.pool) return true;
  for (const rows of [source.history, bookmarks]) {
    let n = 0;
    for (const row of rows) {
      if (pageTexts.has(row)) continue;
      pageText(row);
      if (++n % SLICE_CHECK === 0 && Date.now() > deadline) return false;
    }
  }
  return advance(b, bookmarks, deadline);
}

type TabsOver = { pool: Pool; currentTabId: string | undefined; rows: TabRow[]; tabIds: Map<string, string>; extra: Candidate[]; renamed: Set<string> };
const tabsOverCache = new WeakMap<readonly TabRow[], TabsOver>();

export function tabsOver(pool: Pool, tabs: readonly TabRow[], currentTabId?: string): TabsOver {
  const cached = tabsOverCache.get(tabs);
  if (cached && cached.pool === pool && cached.currentTabId === currentTabId && cached.rows.length === tabs.length) {
    let same = true;
    for (let i = 0; same && i < tabs.length; i++) same = cached.rows[i] === tabs[i];
    if (same) return cached;
  }
  const chosen = new Map<string, TabRow>();
  for (const t of tabs) {
    if (!t.url || t.id === currentTabId) continue;
    const key = pageText(t).key;
    const kept = chosen.get(key);
    if (!kept || (t.customTitle && !kept.customTitle)) chosen.set(key, t);
  }
  const tabIds = new Map<string, string>();
  const extra: Candidate[] = [];
  const renamed = new Set<string>();
  for (const [key, t] of chosen) {
    tabIds.set(key, t.id);
    const listed = pool.byKey.get(key);
    if (!listed) {
      extra.push({ url: t.url, title: t.customTitle || t.title, pageTitle: t.title, favicon: t.favicon, visits: 0, lastVisit: 0, logVisits: 0, fresh: true, bookmarked: false, tabId: t.id, text: tabPageText(t) });
    } else if (t.customTitle) {
      renamed.add(key);
      extra.push({ url: listed.url, title: t.customTitle, favicon: t.favicon ?? listed.favicon, visits: listed.visits, lastVisit: listed.lastVisit, logVisits: listed.logVisits, bookmarked: listed.bookmarked, tabId: t.id, text: tabPageText(t, listed.text) });
    }
  }
  const result = { pool, currentTabId, rows: tabs.slice(), tabIds, extra, renamed };
  tabsOverCache.set(tabs, result);
  return result;
}
