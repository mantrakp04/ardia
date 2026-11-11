export type Searchable = {
  id: string;
  pane: string;
  paneTitle: string;
  section: string;
  title: string;
  description?: string;
  keywords?: string[];
};

export type SearchHit<T extends Searchable = Searchable> = { entry: T; score: number };
export type SearchGroup<T extends Searchable = Searchable> = { pane: string; paneTitle: string; hits: SearchHit<T>[] };

const FIELD_WEIGHTS = { title: 10, keywords: 8, section: 5, paneTitle: 4, description: 2 } as const;
type Field = keyof typeof FIELD_WEIGHTS;

const EXACT = 1;
const PLURAL = 0.95;
const PREFIX = 0.85;
const INSIDE = 0.45;
const TYPO = 0.55;

export const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9⌘⌥⇧⌃]+/g, " ")
    .trim();

const wordsOf = (text: string) => normalize(text).split(" ").filter(Boolean);

export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > limit) return limit + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length]!;
}

const typoLimit = (token: string) => (token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0);

function tokenMatch(token: string, word: string): number {
  if (word === token) return EXACT;
  if (word === `${token}s` || token === `${word}s` || word === `${token}es` || token === `${word}es`) return PLURAL;
  if (word.startsWith(token)) return PREFIX;
  if (token.length >= 3 && word.includes(token)) return INSIDE;
  const limit = typoLimit(token);
  if (!limit || word.length < 3) return 0;
  if (editDistance(token, word, limit) <= limit) return TYPO;
  if (word.length > token.length && editDistance(token, word.slice(0, token.length), limit) <= limit && token[0] === word[0]) return TYPO * 0.9;
  return 0;
}

type Prepared<T extends Searchable> = { entry: T; fields: [Field, string[], string][] };

export function prepare<T extends Searchable>(entries: T[]): Prepared<T>[] {
  return entries.map((entry) => ({
    entry,
    fields: (
      [
        ["title", entry.title],
        ["keywords", (entry.keywords ?? []).join(" ")],
        ["section", entry.section],
        ["paneTitle", entry.paneTitle],
        ["description", entry.description ?? ""],
      ] as [Field, string][]
    ).map(([field, text]) => [field, wordsOf(text), normalize(text)]),
  }));
}

function scoreEntry<T extends Searchable>(p: Prepared<T>, tokens: string[], phrase: string): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [field, words] of p.fields) {
      if (token.length === 1 && field !== "title" && field !== "keywords") continue;
      const weight = FIELD_WEIGHTS[field];
      for (const word of words) {
        const quality = tokenMatch(token, word);
        if (quality && weight * quality > best) best = weight * quality;
      }
    }
    if (!best) return 0;
    total += best;
  }
  const title = p.fields[0]![2];
  const pane = p.fields[3]![2];
  if (phrase.length > 1 && (pane === phrase || pane.startsWith(phrase) || (phrase.startsWith(pane) && phrase.length - pane.length <= 1))) total += 6;
  if (title === phrase) total += 12;
  else if (title.startsWith(phrase)) total += 8;
  else if (` ${title} `.includes(` ${phrase} `)) total += 5;
  else if (tokens.length > 1 && title.includes(phrase)) total += 3;
  else if (` ${p.fields[1]![2]} `.includes(` ${phrase} `)) total += 4;
  return total / tokens.length + (tokens.length > 1 ? total / 40 : 0);
}

const MIN_SCORE = 1.8;

export function search<T extends Searchable>(index: Prepared<T>[], query: string, limit = 40): SearchHit<T>[] {
  const phrase = normalize(query);
  const tokens = phrase.split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const hits: SearchHit<T>[] = [];
  index.forEach((p) => {
    const score = scoreEntry(p, tokens, phrase);
    if (score >= MIN_SCORE) hits.push({ entry: p.entry, score });
  });
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= top * 0.3).slice(0, limit);
}

export function groupByPane<T extends Searchable>(hits: SearchHit<T>[]): SearchGroup<T>[] {
  const groups = new Map<string, SearchGroup<T>>();
  for (const hit of hits) {
    let group = groups.get(hit.entry.pane);
    if (!group) groups.set(hit.entry.pane, (group = { pane: hit.entry.pane, paneTitle: hit.entry.paneTitle, hits: [] }));
    group.hits.push(hit);
  }
  return [...groups.values()];
}
