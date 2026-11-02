import type { Candidate, Pool } from "./candidatePool.ts";
import { shownWordsOf, type PageText } from "./pageText.ts";

export type Query = {
  q: string;
  segmentStarts: [string, string] | null;
  word: boolean;
  spaced: string;
  tokens: { text: string; word: boolean; spaced: string }[];
  needle: string;
};

const WORD = /^[a-z0-9]+$/;

export function parseQuery(q: string, tokens: readonly string[]): Query {
  return {
    q,
    segmentStarts: /[./]/.test(q) ? null : [`.${q}`, `/${q}`],
    word: WORD.test(q),
    spaced: ` ${q}`,
    tokens: tokens.map((text) => ({ text, word: WORD.test(text), spaced: ` ${text}` })),
    needle: tokens.reduce((a, b) => (b.length > a.length ? b : a), ""),
  };
}

export function matchScore(t: PageText, query: Query): number {
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

export function matchScoreWord(t: PageText, query: Query): number {
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

export function narrowing(pool: Pool, q: string, tokens: readonly string[]): Matched | null {
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

export function remember(pool: Pool, q: string, tokens: string[], pages: Candidate[], scores: number[]) {
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

export type Ranked = { c: Candidate; tabId: string | undefined; m: number; s: number };

export class TopList {
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
