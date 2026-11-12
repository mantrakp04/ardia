export type Searchable = {
  id: string;
  pane: string;
  paneTitle: string;
  section: string;
  title: string;
  description?: string;
  keywords?: string[];
};

export type SearchRange = { start: number; end: number };
export type SearchNote = { text: string; ranges: SearchRange[] };
export type SearchHit<T extends Searchable = Searchable> = {
  entry: T;
  score: number;
  tier: number;
  title: SearchRange[];
  section: SearchRange[];
  note?: SearchNote;
};

type Folded = { raw: string; text: string; source: number[]; starts: Uint8Array };

const KEY_SYMBOLS = "⌘⌥⇧⌃";
const WORD_CHAR = /[\p{L}\p{N}]/u;
const MARKS = /\p{M}/gu;
const APOSTROPHES = /['’‘]/;

const isWordChar = (c: string) => WORD_CHAR.test(c) || KEY_SYMBOLS.includes(c);

function foldChar(c: string): string {
  const folded = c.normalize("NFKD").replace(MARKS, "").toLowerCase();
  return folded.length === 1 ? folded : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
}

export function fold(raw: string): Folded {
  let text = "";
  const source: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (APOSTROPHES.test(c) && i > 0 && WORD_CHAR.test(raw[i - 1]!)) continue;
    const f = foldChar(c);
    if (isWordChar(f)) {
      text += f;
      source.push(i);
    } else if (text && !text.endsWith(" ")) {
      text += " ";
      source.push(i);
    }
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    source.pop();
  }
  const starts = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const prev = text[i - 1];
    if (text[i] !== " " && (prev === undefined || prev === " " || KEY_SYMBOLS.includes(prev) || KEY_SYMBOLS.includes(text[i]!))) starts[i] = 1;
  }
  return { raw, text, source, starts };
}

export const normalize = (text: string) => fold(text).text;

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

const WHOLE = 1;
const PLURAL = 0.95;
const EXACT_TITLE_BONUS = 0.5;
const ACRONYM = 0.65;
const JOINED = 0.6;
const JOINED_WHOLE = 0.9;
const TYPO = 0.45;
const MID_WORD = 0.3;
const PREFIX_FLOOR = 0.7;
const STRONG = 0.7;
const MIN_QUALITY = 0.2;
const SHORT_QUERY = 4;

type Kind = "word" | "mid" | "typo" | "joined" | "acronym";
type TokenMatch = { score: number; whole: boolean; kind: Kind; ranges: SearchRange[] };

const wordEnd = (f: Folded, at: number) => {
  let end = at + 1;
  while (end < f.text.length && f.text[end] !== " " && !f.starts[end]) end++;
  return end;
};

const endsWord = (f: Folded, end: number) => end >= f.text.length || f.text[end] === " " || f.starts[end] === 1;

function wordStartMatch(f: Folded, token: string, midWord: boolean): TokenMatch | null {
  let best: TokenMatch | null = null;
  for (let at = f.text.indexOf(token); at !== -1; at = f.text.indexOf(token, at + 1)) {
    const end = at + token.length;
    if (f.starts[at]) {
      if (endsWord(f, end)) return { score: WHOLE, whole: true, kind: "word", ranges: [{ start: at, end }] };
      const word = wordEnd(f, at);
      const rest = f.text.slice(end, word);
      const plural = rest === "s" || rest === "es";
      const score = plural ? PLURAL : PREFIX_FLOOR + (0.2 * token.length) / (word - at);
      if (!best || score > best.score) best = { score, whole: plural, kind: "word", ranges: [{ start: at, end }] };
    } else if (midWord && token.length >= 4 && !best) {
      best = { score: MID_WORD, whole: false, kind: "mid", ranges: [{ start: at, end }] };
    }
  }
  if (!best && token.length > 2) {
    for (let at = 0; at < f.text.length; at++) {
      if (!f.starts[at]) continue;
      const end = wordEnd(f, at);
      const word = f.text.slice(at, end);
      if (token === `${word}s` || token === `${word}es`) return { score: PLURAL, whole: true, kind: "word", ranges: [{ start: at, end }] };
    }
  }
  return best;
}

function joinedMatch(f: Folded, token: string): TokenMatch | null {
  for (let at = 0; at < f.text.length; at++) {
    if (!f.starts[at] || f.text[at] !== token[0]) continue;
    const ranges: SearchRange[] = [];
    let rest = token;
    let pos = at;
    while (rest && pos < f.text.length) {
      const end = wordEnd(f, pos);
      const word = f.text.slice(pos, end);
      if (rest.length <= word.length && word.startsWith(rest)) {
        ranges.push({ start: pos, end: pos + rest.length });
        rest = "";
      } else if (rest.startsWith(word)) {
        ranges.push({ start: pos, end });
        rest = rest.slice(word.length);
        pos = end;
        while (pos < f.text.length && !f.starts[pos]) pos++;
      } else break;
    }
    const last = ranges.at(-1);
    if (rest || !last || ranges.length < 2) continue;
    if (last.end - last.start >= 3 || endsWord(f, last.end)) return endsWord(f, last.end) ? { score: JOINED_WHOLE, whole: true, kind: "joined", ranges } : { score: JOINED, whole: false, kind: "joined", ranges };
  }
  return null;
}

function acronymMatch(f: Folded, token: string): TokenMatch | null {
  if (token.length < 2 || !/^[a-z]+$/.test(token)) return null;
  const starts: number[] = [];
  for (let i = 0; i < f.text.length; i++) if (f.starts[i] && /[a-z]/.test(f.text[i]!)) starts.push(i);
  for (let s = 0; s + token.length <= starts.length; s++) {
    if (token.split("").every((c, k) => f.text[starts[s + k]!] === c)) {
      return { score: ACRONYM, whole: true, kind: "acronym", ranges: starts.slice(s, s + token.length).map((i) => ({ start: i, end: i + 1 })) };
    }
  }
  return null;
}

const isSubsequence = (needle: string, hay: string) => {
  let from = 0;
  for (const c of needle) {
    const at = hay.indexOf(c, from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
};

function typoMatch(f: Folded, token: string): TokenMatch | null {
  if (token.length < 3 || !/[a-z]/.test(token)) return null;
  const short = token.length <= 4;
  const limit = token.length >= 8 ? 2 : 1;
  for (let at = 0; at < f.text.length; at++) {
    if (!f.starts[at]) continue;
    const firstKept = f.text[at] === token[0] || (token.length > 3 && f.text[at] === token[1] && f.text[at + 1] === token[0]);
    if (!firstKept) continue;
    const word = f.text.slice(at, wordEnd(f, at));
    const lengths = short ? [token.length, token.length + 1] : [token.length, token.length - 1, token.length + 1, token.length + 2, word.length];
    for (const length of lengths) {
      if (length > word.length || length < 3) continue;
      const prefix = word.slice(0, length);
      const ok = short
        ? (length === token.length && editDistance(token, prefix, 1) === 1 && [...token].sort().join("") === [...prefix].sort().join("")) || (length === token.length + 1 && isSubsequence(token, prefix))
        : editDistance(token, prefix, limit) <= limit;
      if (ok) return { score: TYPO, whole: length === word.length, kind: "typo", ranges: [{ start: at, end: at + length }] };
    }
  }
  return null;
}

type FieldRole = "title" | "keyword" | "section" | "pane" | "description";
type Field = { role: FieldRole; folded: Folded; weight: number };

function matchField(field: Field, token: string, typos: boolean, shortQuery: boolean): TokenMatch | null {
  const { role, folded } = field;
  if (!folded.text) return null;
  if (role === "title") {
    let m = wordStartMatch(folded, token, true);
    if (!m || m.kind === "mid") m = joinedMatch(folded, token) ?? acronymMatch(folded, token) ?? m;
    if (!m && typos) m = typoMatch(folded, token);
    return m;
  }
  const m = wordStartMatch(folded, token, false);
  if (!m || m.kind !== "word") return null;
  if (role === "keyword" && shortQuery && !m.whole) return null;
  if (role === "description" && !m.whole && (shortQuery || token.length < SHORT_QUERY)) return null;
  if (token.length === 1 && role !== "keyword") return null;
  return m;
}

type Prepared<T extends Searchable> = { entry: T; fields: Field[]; titleLength: number; keywordPhrases: string[] };

export function prepare<T extends Searchable>(entries: T[]): Prepared<T>[] {
  return entries.map((entry) => {
    const sectionShown = entry.section !== entry.title && entry.section !== entry.paneTitle;
    const fields: Field[] = [
      { role: "title", folded: fold(entry.title), weight: 1 },
      ...(entry.keywords ?? []).map((k): Field => ({ role: "keyword", folded: fold(k), weight: 0.6 })),
      { role: "section", folded: fold(sectionShown ? entry.section : ""), weight: 0.55 },
      { role: "pane", folded: fold(entry.paneTitle), weight: 0.5 },
      { role: "description", folded: fold(entry.description ?? ""), weight: 0.4 },
    ];
    return { entry, fields, titleLength: entry.title.length, keywordPhrases: (entry.keywords ?? []).map(normalize) };
  });
}

const FILLER = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);

type Scored<T extends Searchable> = SearchHit<T> & { whole: boolean; strong: boolean; order: number; titleLength: number; viaPane: boolean };

const toSource = (f: Folded, ranges: SearchRange[]): SearchRange[] =>
  mergeRanges(ranges.map((r) => ({ start: f.source[r.start]!, end: f.source[r.end - 1]! + 1 })));

function mergeRanges(ranges: SearchRange[]): SearchRange[] {
  const out: SearchRange[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function scoreEntry<T extends Searchable>(p: Prepared<T>, tokens: string[], phrase: string, typos: boolean, order: number): Scored<T> | null {
  const meaningful = tokens.filter((t) => !FILLER.has(t));
  const fillerOptional = meaningful.length > 0;
  const shortQuery = (meaningful.join(" ") || phrase).length < SHORT_QUERY;
  const titleRanges: SearchRange[] = [];
  const sectionRanges: SearchRange[] = [];
  const notes = new Map<Field, SearchRange[]>();
  let total = 0;
  let counted = 0;
  let whole = true;
  let strong = true;
  let anyWordStart = false;
  let viaPane = false;
  for (const token of tokens) {
    let best: { value: number; field: Field; match: TokenMatch } | null = null;
    let tokenStrong = false;
    let tokenWhole = false;
    for (const field of p.fields) {
      const match = matchField(field, token, typos, shortQuery);
      if (!match) continue;
      const weight = field.role === "keyword" && shortQuery ? 0.8 : field.weight;
      const value = match.score * weight;
      const named = field.role === "title" || field.role === "keyword" || (field.role === "pane" && match.whole);
      if (named && match.kind !== "typo" && (match.score >= STRONG || match.kind === "joined" || match.kind === "acronym")) tokenStrong = true;
      if ((field.role === "title" || field.role === "keyword") && match.whole && match.kind !== "typo") tokenWhole = true;
      if (!best || value > best.value) best = { value, field, match };
    }
    if (!best) {
      if (fillerOptional && FILLER.has(token)) continue;
      return null;
    }
    if (best.match.kind === "word" || best.match.kind === "joined" || best.match.kind === "acronym") anyWordStart = true;
    if (FILLER.has(token) && fillerOptional) {
      total += best.value;
      counted++;
      continue;
    }
    strong &&= tokenStrong;
    whole &&= tokenWhole;
    total += best.value;
    counted++;
    const { field, match } = best;
    if (field.role === "pane") viaPane = true;
    if (field.role === "title") titleRanges.push(...match.ranges);
    else if (field.role === "section") sectionRanges.push(...match.ranges);
    else if (field.role === "keyword" || field.role === "description") notes.set(field, [...(notes.get(field) ?? []), ...match.ranges]);
  }
  if (!counted) return null;
  let score = total / counted;
  const title = p.fields[0]!.folded.text;
  if (title === phrase) score += EXACT_TITLE_BONUS;
  else if (tokens.length > 1 && ` ${title} `.includes(` ${phrase} `)) score += 0.25;
  else if (p.keywordPhrases.includes(phrase)) score += 0.2;
  if (score < MIN_QUALITY) return null;
  const tier = score >= WHOLE + EXACT_TITLE_BONUS ? 3 : strong ? 2 : anyWordStart ? 1 : 0;
  const [noteField, noteRanges] = [...notes].sort((a, b) => (a[0].role === "keyword" ? 0 : 1) - (b[0].role === "keyword" ? 0 : 1))[0] ?? [];
  const sectionField = p.fields.find((f) => f.role === "section")!;
  return {
    entry: p.entry,
    score,
    tier,
    whole,
    strong,
    order,
    titleLength: p.titleLength,
    viaPane,
    title: toSource(p.fields[0]!.folded, titleRanges),
    section: toSource(sectionField.folded, sectionRanges),
    note: titleRanges.length || !noteField ? undefined : { text: noteField.folded.raw, ranges: toSource(noteField.folded, noteRanges!) },
  };
}

const compare = <T extends Searchable>(a: Scored<T>, b: Scored<T>) =>
  b.tier - a.tier || Number(b.whole) - Number(a.whole) || b.score - a.score || a.titleLength - b.titleLength || a.order - b.order;

export function search<T extends Searchable>(index: Prepared<T>[], query: string, limit = 40): SearchHit<T>[] {
  const phrase = normalize(query.replace(/^\s*["“”]+|["“”]+\s*$/g, ""));
  const tokens = phrase.split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const rank = (typos: boolean) => index.flatMap((p, order) => scoreEntry(p, tokens, phrase, typos, order) ?? []);
  let hits = rank(false);
  if (!hits.some((h) => h.strong)) hits = rank(true);
  hits.sort(compare);
  const topTier = hits[0]?.tier ?? 0;
  const shown = hits.filter((h) => topTier < 2 || h.tier > 0);
  const placeOf = (h: Scored<T>) => `${h.entry.pane}\u0000${h.entry.section}`;
  const named = (h: Scored<T>) => h.title.length > 0 || h.viaPane;
  const landed = new Set(shown.filter(named).map(placeOf));
  return shown
    .filter((h) => {
      if (named(h)) return true;
      const place = placeOf(h);
      if (landed.has(place)) return false;
      landed.add(place);
      return true;
    })
    .slice(0, limit)
    .map(({ entry, score, tier, title, section, note }) => ({ entry, score, tier, title, section, ...(note ? { note } : {}) }));
}

export type SearchTextPart = { text: string; highlighted: boolean };

export function splitByRanges(text: string, ranges: SearchRange[]): SearchTextPart[] {
  const parts: SearchTextPart[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) parts.push({ text: text.slice(cursor, r.start), highlighted: false });
    parts.push({ text: text.slice(r.start, r.end), highlighted: true });
    cursor = r.end;
  }
  if (cursor < text.length || !parts.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}

export function snippetAround(text: string, ranges: SearchRange[], room = 48): { text: string; ranges: SearchRange[] } {
  const first = ranges[0];
  if (!first || text.length <= room || first.end <= room - 8) return { text, ranges };
  let start = Math.max(0, first.start - 16);
  while (start > 0 && text[start - 1] !== " ") start--;
  const cut = `…${text.slice(start)}`;
  return { text: cut, ranges: ranges.filter((r) => r.start >= start).map((r) => ({ start: r.start - start + 1, end: r.end - start + 1 })) };
}
