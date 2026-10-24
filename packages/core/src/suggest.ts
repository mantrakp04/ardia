import { findBang, type BangMatch, type BangTable } from "./bangs.ts";
import { calculate } from "./calculator.ts";
import { BUILT_IN_ENGINES, searchUrl, type SearchEngine } from "./engines.ts";
import { matchActions, type ActionCandidate } from "./fuzzy.ts";
import { fixupUrl, hostOf, urlForDisplay } from "./omnibox.ts";
import { matchQuickCreate } from "./quickCreate.ts";
import { scopedSearchUrl, type SearchScope } from "./siteSearch.ts";

export type SuggestionSource = {
  tabs: readonly { id: string; url: string; title: string; favicon: string | null }[];
  history: readonly { url: string; title: string; favicon: string | null; visits: number; lastVisit: number }[];
  bookmarks?: readonly { url: string; title: string; favicon: string | null }[];
};

export type CommandAction = ActionCandidate & { icon?: string; hint?: string };

export type Suggestion =
  | {
      kind: "page";
      url: string;
      title: string;
      favicon: string | null;
      tabId?: string;
      bookmarked?: boolean;
      visited?: boolean;
    }
  | { kind: "search"; query: string; url: string; engine: string; suggested?: boolean; bang?: true }
  | { kind: "calc"; expression: string; value: string; url: string }
  | { kind: "action"; id: string; title: string; icon?: string; hint?: string }
  | { kind: "create"; id: string; title: string; url: string; site: string };

export type SuggestionResult = {
  items: Suggestion[];
  completion: string;
};

export type SuggestOptions = {
  limit?: number;
  now?: number;
  engine?: Pick<SearchEngine, "name" | "url">;
  preference?: "website" | "search";
  remote?: readonly string[];
  actions?: readonly CommandAction[];
  currentTabId?: string;
  currentUrl?: string;
  scope?: SearchScope | null;
  preventInline?: boolean;
  bangs?: BangTable | null;
};

export function displayUrl(url: string): string {
  return urlForDisplay(url).replace(/\/$/, "");
}

const DAY = 86_400_000;
const pageKey = (url: string) => url.replace(/#.*$/, "").replace(/\/$/, "");

type HistoryRow = SuggestionSource["history"][number];
type BookmarkRow = NonNullable<SuggestionSource["bookmarks"]>[number];
type TabRow = SuggestionSource["tabs"][number];

type PageText = {
  url: string;
  key: string;
  shown: string;
  shownLower: string;
  titleLower: string;
  titleWords: string;
  shownWords?: string;
  shownBlank?: boolean;
  host?: string;
  origin?: string | null;
  hostLower?: string;
};

const pageTexts = new WeakMap<object, PageText>();

const logVisitsOf: number[] = [];
const logVisits = (visits: number) => (visits >= 0 && visits < 1024 && (visits | 0) === visits ? (logVisitsOf[visits] ??= Math.log2(1 + visits) * 8) : Math.log2(1 + visits) * 8);

const NOT_WORD = /[^a-z0-9]+/g;
const PLAIN_WORDS = /^[a-z0-9]+(?: [a-z0-9]+)*$/;
const wordsOf = (lower: string) => (PLAIN_WORDS.test(lower) ? ` ${lower}` : ` ${lower}`.replace(NOT_WORD, " "));
const shownWordsOf = (t: PageText) => (t.shownWords ??= wordsOf(t.shownLower));

function pageText(row: { url: string; title: string }): PageText {
  let text = pageTexts.get(row);
  if (!text) {
    const shown = displayUrl(row.url);
    const shownLower = shown.toLowerCase();
    const titleLower = row.title.toLowerCase();
    text = { url: row.url, key: pageKey(row.url), shown, shownLower, titleLower, titleWords: wordsOf(titleLower) };
    pageTexts.set(row, text);
  }
  return text;
}

const hostOfPage = (t: PageText) => (t.host ??= hostOf(t.url));
const hostPart = (shown: string) => /^[^/?#]*/.exec(shown)![0];
const hostLowerOfPage = (t: PageText) => (t.hostLower ??= hostPart(t.shownLower));
const originOfPage = (t: PageText) => (t.origin === undefined ? (t.origin = /^https?:\/\/[^/?#]+/i.exec(t.url)?.[0] ?? null) : t.origin);

type Candidate = {
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
type Pool = { list: Candidate[]; byKey: Lookup };

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
const NO_BOOKMARKS: readonly BookmarkRow[] = [];
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

function poolFor(history: readonly HistoryRow[], bookmarks: readonly BookmarkRow[]): Pool {
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

type TabsOver = { pool: Pool; currentTabId: string | undefined; rows: TabRow[]; tabIds: Map<string, string>; extra: Candidate[] };
const tabsOverCache = new WeakMap<readonly TabRow[], TabsOver>();

function tabsOver(pool: Pool, tabs: readonly TabRow[], currentTabId?: string): TabsOver {
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

type Query = {
  q: string;
  segmentStarts: [string, string] | null;
  word: boolean;
  spaced: string;
  tokens: { text: string; word: boolean; spaced: string }[];
  needle: string;
};

const WORD = /^[a-z0-9]+$/;

function parseQuery(q: string, tokens: readonly string[]): Query {
  return {
    q,
    segmentStarts: /[./]/.test(q) ? null : [`.${q}`, `/${q}`],
    word: WORD.test(q),
    spaced: ` ${q}`,
    tokens: tokens.map((text) => ({ text, word: WORD.test(text), spaced: ` ${text}` })),
    needle: tokens.reduce((a, b) => (b.length > a.length ? b : a), ""),
  };
}

function matchScore(t: PageText, query: Query): number {
  const shown = t.shownLower;
  const title = t.titleLower;
  const { q } = query;
  if (!shown.includes(query.needle) && !title.includes(query.needle)) return 0;
  let s = 0;
  if ((t.shownBlank ??= /\s/.test(shown))) {
    const seg = query.segmentStarts;
    if (shown.startsWith(q)) s = 100;
    else if (seg && (shown.includes(seg[0]) || shown.includes(seg[1]))) s = 60;
    else if (shown.includes(q)) s = 30;
  }
  const ti = title.indexOf(q);
  if (ti === 0) s += 40;
  else if (ti > 0) s += 20;
  if (s > 0) return s;
  for (const token of query.tokens) {
    if (token.word && t.titleWords.includes(token.spaced)) s += 15;
    else if (token.word && shownWordsOf(t).includes(token.spaced)) s += 10;
    else if (token.text.length >= 3 && (title.includes(token.text) || shown.includes(token.text))) s += 5;
    else return 0;
  }
  return s;
}

function matchScoreWord(t: PageText, query: Query): number {
  const shown = t.shownLower;
  const title = t.titleLower;
  const q = query.q;
  const si = shown.indexOf(q);
  const ti = title.indexOf(q);
  if (si < 0 && ti < 0) return 0;
  let s = 0;
  if (si === 0) s = 100;
  else if (si > 0) {
    const seg = query.segmentStarts;
    if (seg && (shown.includes(seg[0]) || shown.includes(seg[1]))) s = 60;
    else if (q.length >= 2) s = 30;
  }
  if (ti === 0) s += 40;
  else if (q.length >= 2 ? ti > 0 : query.word && t.titleWords.includes(query.spaced)) s += 20;
  return s;
}

type Matched = { q: string; tokens: string[]; pages: Candidate[]; scores: number[] };
const MATCHED_KEPT = 8;
let matchedChain: { pool: Pool; list: Matched[] } = { pool: null as unknown as Pool, list: [] };

function narrowing(pool: Pool, q: string, tokens: readonly string[]): Matched | null {
  const chain = matchedChain;
  if (chain.pool !== pool) return null;
  for (let k = chain.list.length - 1; k >= 0; k--) {
    const last = chain.list[k]!;
    if (!q.startsWith(last.q)) continue;
    const i = last.tokens.length - 1;
    const word = last.tokens[i]!;
    if (i === 0 || word === tokens[i] || word.length >= 3) return last;
  }
  return null;
}

function remember(pool: Pool, q: string, tokens: string[], pages: Candidate[], scores: number[]) {
  let chain = matchedChain;
  if (chain.pool !== pool) matchedChain = chain = { pool, list: [] };
  const list = chain.list;
  while (list.length && !q.startsWith(list[list.length - 1]!.q)) list.pop();
  if (q.length < 2) {
    list.length = 0;
    return;
  }
  if (list.length && list[list.length - 1]!.q === q) list.pop();
  list.push({ q, tokens, pages, scores });
  if (list.length > MATCHED_KEPT) list.shift();
}

type Ranked = { c: Candidate; tabId: string | undefined; m: number; s: number };

class TopList {
  readonly items: Ranked[] = [];
  floor = -Infinity;
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  offer(r: Ranked) {
    const items = this.items;
    if (items.length === this.size && items[items.length - 1]!.s >= r.s) return;
    let i = items.length;
    while (i > 0 && items[i - 1]!.s < r.s) i--;
    items.splice(i, 0, r);
    if (items.length > this.size) items.pop();
    if (items.length === this.size) this.floor = items[items.length - 1]!.s;
  }
}

const pageSuggestion = (c: Candidate, tabId: string | null | undefined = c.tabId): Suggestion => ({
  kind: "page",
  url: c.url,
  title: c.title,
  favicon: c.favicon,
  ...(tabId ? { tabId } : {}),
  ...(c.bookmarked ? { bookmarked: true } : {}),
  ...(c.visits > 0 ? { visited: true } : {}),
});

export function suggestionKey(s: Suggestion): string {
  switch (s.kind) {
    case "page":
      return `${s.tabId ? "tab" : "page"}:${pageKey(s.url)}`;
    case "search":
      return `search:${s.url}`;
    case "calc":
      return `calc:${s.expression}`;
    case "action":
      return `action:${s.id}`;
    case "create":
      return `create:${s.id}`;
  }
}

export function buildSuggestions(raw: string, source: SuggestionSource, options: SuggestOptions = {}): SuggestionResult {
  const { limit = 8, now = Date.now(), engine = BUILT_IN_ENGINES[0]!, preference = "website", remote = [], actions = [], scope, preventInline = false } = options;
  const query = raw.trim();
  if (!query) return { items: [], completion: "" };
  const bare = query[0] === "h" || query[0] === "H" ? query.replace(/^https?:\/\/(?=\S)/i, "") : query;
  const q = bare.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const bang = scope ? null : findBang(query, options.bangs);
  if (bang) return bangSuggestions(bang, source, options, limit);

  if (!scope && query.startsWith("?")) {
    const text = query.slice(1).trim();
    if (!text) return { items: [], completion: "" };
    const out = new Output(limit);
    out.push({ kind: "search", query: text, url: searchUrl(engine, text), engine: engine.name });
    out.push(...dedupeSuggestions(remote, text).slice(0, 4).map((t): Suggestion => ({ kind: "search", query: t, url: searchUrl(engine, t), engine: engine.name, suggested: true })));
    return { items: out.items, completion: "" };
  }

  const pool = poolFor(source.history, source.bookmarks ?? NO_BOOKMARKS);
  const { tabIds, extra } = tabsOver(pool, source.tabs, options.currentTabId);
  const currentKey = options.currentUrl ? pageKey(options.currentUrl) : null;
  const known = (url: string) => {
    const key = pageKey(url);
    const c = pool.byKey.get(key) ?? extra.find((x) => x.text.key === key);
    return c && pageSuggestion(c, null);
  };

  const websiteFirst = preference === "website";
  const oneWord = tokens.length === 1;
  const noInline = preventInline || (oneWord && raw.length !== query.length && /\s$/.test(raw));
  const completes = websiteFirst && !scope && oneWord && !noInline;
  const from = narrowing(pool, q, tokens);
  const pages = from ? from.pages : pool.list;
  const again = from !== null && from.q === q;
  const parsed = parseQuery(q, tokens);
  const matched: Candidate[] = again ? from.pages : [];
  const scores: number[] = again ? from.scores : [];
  let found = 0;
  const top = new TopList(limit + 1);
  const onSite = scope ? new TopList(4) : null;
  const score = oneWord ? matchScoreWord : matchScore;
  const bound = Boolean(scope);
  let inline: Ranked | null = null;
  for (const list of [pages, extra]) {
    const inPages = list === pages;
    for (let at = 0; at < list.length; at++) {
      const c = list[at]!;
      const m = again && inPages ? scores[at]! : score(c.text, parsed);
      if (m <= 0) continue;
      if (inPages && !again) {
        matched[found] = c;
        scores[found++] = m;
      }
      const key = c.text.key;
      const derank = currentKey !== null && key === currentKey ? 80 : 0;
      const lastVisit = c.fresh ? now : c.lastVisit;
      let age = 10;
      if (lastVisit) {
        const d = (now - lastVisit) / DAY;
        age = d < 0 ? 0 : d > 30 ? 30 : d;
      }
      const base = c.logVisits - age + (c.bookmarked ? 20 : 0);
      if (!bound && top.floor >= m + base - derank + 7) {
        if (!completes) continue;
        if (inline === null ? false : inline.s >= m + base - derank + 7) continue;
        if (c.visits <= 0 || !c.text.shownLower.startsWith(q)) continue;
      }
      const tabId = c.tabId ?? tabIds.get(key);
      const s = m + (base + (tabId ? 6 : 0)) - derank;
      let r: Ranked | undefined;
      if (top.floor < s || top.items.length < limit + 1) {
        r = { c, tabId, m, s };
        top.offer(r);
      }
      if (onSite) {
        const host = hostOfPage(c.text);
        if (host === scope!.host || host.endsWith(`.${scope!.host}`)) onSite.offer(r ?? { c, tabId, m, s });
      }
      if (completes && (!inline || s > inline.s) && c.visits > 0 && inlineMatch(c.text, q)) inline = r ?? { c, tabId, m, s };
    }
  }
  remember(pool, q, tokens, matched, scores);
  const ranked = top.items;

  const out = new Output(limit);
  const remoteRows = (url: (text: string) => string, name: string) =>
    dedupeSuggestions(remote, query)
      .slice(0, 4)
      .map((text): Suggestion => ({ kind: "search", query: text, url: url(text), engine: name, suggested: true }));

  if (scope) {
    const scopedUrl = (text: string) => scopedSearchUrl(scope, text, engine);
    out.push({ kind: "search", query, url: scopedUrl(query), engine: scope.name });
    out.push(...remoteRows(scopedUrl, scope.name));
    out.push(...onSite!.items.map((x) => pageSuggestion(x.c, x.tabId)));
    return { items: out.items, completion: "" };
  }

  const search: Suggestion = { kind: "search", query, url: searchUrl(engine, query), engine: engine.name };
  const typedUrl = fixupUrl(query);
  const calc = calculate(query);
  const creates = matchQuickCreate(raw.trimStart());
  const actionRows = query.length >= 4 ? 4 : 2;
  const actionMatches = matchActions(query, actions, actionRows).filter((m) => m.exact || m.score >= 50);

  const best = ranked[0];
  const target = inline && inlineTarget(q, inline.c);
  const completion = target ? target.text.slice(bare.length) : "";

  let first: Suggestion;
  if (creates.length && /^\S+\s+\S/.test(query)) first = createRow(creates[0]!);
  else if (actionMatches[0]?.exact) first = actionRow(actionMatches[0].action);
  else if (target && completion) first = known(target.url) ?? { kind: "page", url: target.url, title: "", favicon: target.favicon };
  else if (typedUrl) first = known(typedUrl) ?? { kind: "page", url: typedUrl, title: "", favicon: null };
  else if (websiteFirst && best && best.m >= 40 && (!noInline || typedIsPage(best.c.text, q))) first = pageSuggestion(best.c, best.tabId);
  else first = search;

  out.push(first);
  out.push(search);
  if (calc) out.push({ kind: "calc", expression: calc.expression, value: calc.display, url: searchUrl(engine, calc.expression) });
  out.push(...actionMatches.map((m) => actionRow(m.action)));
  out.push(...creates.map(createRow));
  const pageRows = ranked.map((x) => pageSuggestion(x.c, x.tabId));
  out.push(...pageRows.slice(0, 3));
  out.push(...remoteRows((text) => searchUrl(engine, text), engine.name));
  out.push(...pageRows.slice(3));
  return { items: out.items, completion };
}

function typedIsPage(t: PageText, q: string): boolean {
  return q === t.shownLower || q === hostLowerOfPage(t);
}

function inlineMatch(t: PageText, q: string): boolean {
  if (hostLowerOfPage(t).startsWith(q) && originOfPage(t)) return true;
  return q.includes("/") && !/[?#]/.test(t.shown) && t.shownLower.startsWith(q);
}

function inlineTarget(q: string, c: Candidate): { text: string; url: string; favicon: string | null } {
  const origin = originOfPage(c.text);
  const host = hostPart(c.text.shown);
  if (origin && host.toLowerCase().startsWith(q)) return { text: host, url: `${origin}/`, favicon: c.favicon };
  return { text: c.text.shown, url: c.url, favicon: c.favicon };
}

function bangSuggestions(match: BangMatch, source: SuggestionSource, options: SuggestOptions, limit: number): SuggestionResult {
  const { bang, query } = match;
  const out = new Output(limit);
  if (!query) {
    out.push({ kind: "page", url: bang.home, title: bang.name, favicon: null });
    return { items: out.items, completion: "" };
  }
  out.push({ kind: "search", query, url: match.url, engine: bang.name, bang: true });
  const scope: SearchScope = { kind: "site", name: bang.name, host: hostOf(bang.home), url: bang.template };
  out.push(...buildSuggestions(query, source, { ...options, scope, remote: [], bangs: null }).items.slice(1));
  return { items: out.items, completion: "" };
}

class Output {
  readonly items: Suggestion[] = [];
  private readonly seen = new Set<string>();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  push(...rows: Suggestion[]) {
    for (const row of rows) {
      const key = suggestionKey(row);
      if (this.items.length >= this.limit || this.seen.has(key)) continue;
      this.seen.add(key);
      this.items.push(row);
    }
  }
}

const createRow = (c: { id: string; title: string; url: string; site: string }): Suggestion => ({ kind: "create", id: c.id, title: c.title, url: c.url, site: c.site });

const actionRow = (a: CommandAction): Suggestion => ({
  kind: "action",
  id: a.id,
  title: a.title,
  ...(a.icon ? { icon: a.icon } : {}),
  ...(a.hint ? { hint: a.hint } : {}),
});

function dedupeSuggestions(remote: readonly string[], query: string): string[] {
  const seen = new Set([query.trim().toLowerCase()]);
  return remote.filter((s) => {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
