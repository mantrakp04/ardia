import { findBang, type BangMatch } from "./bangs.ts";
import { calculate } from "./calculator.ts";
import { NO_BOOKMARKS, poolFor, tabsOver, type Candidate } from "./candidatePool.ts";
import { extensionSuggestions } from "./extensionRows.ts";
import { BUILT_IN_ENGINES, searchUrl } from "./engines.ts";
import { matchActions } from "./fuzzy.ts";
import { fixupUrl, hostOf } from "./omnibox.ts";
import { matchScore, matchScoreWord, narrowing, parseQuery, remember, TopList, type Ranked } from "./pageMatch.ts";
import { hostLowerOfPage, hostOfPage, hostPart, originOfPage, pageKey, type PageText } from "./pageText.ts";
import { matchQuickCreate } from "./quickCreate.ts";
import { scopedSearchUrl, type SearchScope } from "./siteSearch.ts";
import type { SuggestionResult, SuggestionSource, SuggestOptions, Suggestion } from "./suggestion.ts";
import { actionRow, createRow, dedupeSuggestions, Output, pageSuggestion } from "./suggestionRows.ts";

export type { CommandAction, Suggestion, SuggestionResult, SuggestionSource, SuggestOptions } from "./suggestion.ts";
export { displayUrl } from "./pageText.ts";
export { prepareSuggestions } from "./candidatePool.ts";
export { suggestionKey } from "./suggestionRows.ts";

const DAY = 86_400_000;

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
  const extensionMatches = extensionSuggestions(query, options.extensions ?? []);

  const best = ranked[0];
  const target = inline && inlineTarget(q, inline.c);
  const completion = target ? target.text.slice(bare.length) : "";

  let first: Suggestion;
  if (creates.length && /^\S+\s+\S/.test(query)) first = createRow(creates[0]!);
  else if (actionMatches[0]?.exact) first = actionRow(actionMatches[0].action);
  else if (target && completion) first = known(target.url) ?? { kind: "page", url: target.url, title: "", favicon: target.favicon };
  else if (typedUrl) first = known(typedUrl) ?? { kind: "page", url: typedUrl, title: "", favicon: null };
  else if (extensionMatches.exact) first = extensionMatches.rows[0]!;
  else if (websiteFirst && best && best.m >= 40 && (!noInline || typedIsPage(best.c.text, q))) first = pageSuggestion(best.c, best.tabId);
  else first = search;

  out.push(first);
  out.push(search);
  if (calc) out.push({ kind: "calc", expression: calc.expression, value: calc.display, url: searchUrl(engine, calc.expression) });
  out.push(...actionMatches.map((m) => actionRow(m.action)));
  out.push(...extensionMatches.rows);
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
