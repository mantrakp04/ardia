export type Pages = Record<string, string | null>;
type Profiles = Record<string, { pages: Pages }>;
const pagesWritten = new WeakMap<Pages, { base: Pages; pages: string[] }>();
const MAX_WRITE_HOPS = 16;

export function withPages(base: Pages, writes: [string, string | null][]): Pages {
  const next = { ...base };
  for (const [page, uri] of writes) next[page] = uri;
  pagesWritten.set(next, { base, pages: writes.map(([page]) => page) });
  return next;
}

export function pagesWrittenSince(now: Pages, before: Pages): string[] | null {
  const pages: string[] = [];
  let at = now;
  for (let hops = 0; at !== before; hops++) {
    const write = pagesWritten.get(at);
    if (!write || hops >= MAX_WRITE_HOPS) return null;
    for (const page of write.pages) pages.push(page);
    at = write.base;
  }
  return pages;
}

export type PagesPair = { now: Pages | undefined; before: Pages | undefined };

export function changedPages(f: { profiles: Profiles }, prev: { profiles: Profiles }): PagesPair[] {
  const pairs: PagesPair[] = [];
  for (const key in f.profiles) {
    const now = f.profiles[key]!.pages;
    const before = prev.profiles[key]?.pages;
    if (now !== before) pairs.push({ now, before });
  }
  for (const key in prev.profiles) if (!(key in f.profiles)) pairs.push({ now: undefined, before: prev.profiles[key]!.pages });
  return pairs;
}
