export type VisitedPage = { url: string; title: string; favicon: string | null; visits: number; lastVisit: number; visitTimes?: number[] };
export type SiteSuggestion = { host: string; url: string; title: string; favicon: string | null };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HALF_LIFE_DAYS = 21;

export function hostOf(url: string): string {
  const m = /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url);
  return m ? m[1]!.toLowerCase() : "";
}

export function greetingFor(now: Date, name: string): string {
  const h = now.getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function hourGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

const weekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

function visitWeight(visit: number, now: Date): number {
  const at = new Date(visit);
  const gap = hourGap(at.getHours() + at.getMinutes() / 60, now.getHours() + now.getMinutes() / 60);
  const hourMatch = gap <= 1 ? 1 : gap <= 2 ? 0.5 : gap <= 3 ? 0.15 : 0;
  if (!hourMatch) return 0;
  const dayMatch = weekend(at) === weekend(now) ? 1 : 0.4;
  const age = Math.max(0, now.getTime() - visit) / DAY;
  return hourMatch * dayMatch * Math.pow(0.5, age / HALF_LIFE_DAYS);
}

type Site = { host: string; best: VisitedPage; bestVisits: number; score: number; visits: number; lastVisit: number };

function bySite(pages: readonly VisitedPage[], score: (p: VisitedPage) => number, skip: ReadonlySet<string>): Site[] {
  const sites = new Map<string, Site>();
  for (const p of pages) {
    const host = hostOf(p.url);
    if (!host || skip.has(host)) continue;
    const site = sites.get(host) ?? { host, best: p, bestVisits: -1, score: 0, visits: 0, lastVisit: 0 };
    site.score += score(p);
    site.visits += p.visits;
    site.lastVisit = Math.max(site.lastVisit, p.lastVisit);
    if (p.visits > site.bestVisits) {
      site.best = p;
      site.bestVisits = p.visits;
    }
    sites.set(host, site);
  }
  return [...sites.values()];
}

const toSuggestion = (s: Site): SiteSuggestion => ({ host: s.host, url: s.best.url, title: s.best.title || s.host, favicon: s.best.favicon });

export function suggestedForNow(pages: readonly VisitedPage[], now: Date, skip: ReadonlySet<string> = new Set(), limit = 6): SiteSuggestion[] {
  const score = (p: VisitedPage) => {
    const times = p.visitTimes?.length ? p.visitTimes : [p.lastVisit];
    return times.reduce((sum, t) => sum + visitWeight(t, now), 0);
  };
  return bySite(pages, score, skip)
    .filter((s) => s.score > 0.05)
    .sort((a, b) => b.score - a.score || b.visits - a.visits)
    .slice(0, limit)
    .map(toSuggestion);
}

export function recentSites(pages: readonly VisitedPage[], skip: ReadonlySet<string> = new Set(), limit = 6): SiteSuggestion[] {
  return bySite(pages, () => 0, skip)
    .sort((a, b) => b.lastVisit - a.lastVisit)
    .slice(0, limit)
    .map(toSuggestion);
}

export function greetingName(byName: boolean, custom: string | undefined, systemName: () => string): string {
  return byName ? custom?.trim() || systemName() : "";
}

const NO_HOME_HISTORY: readonly never[] = [];

export function homeHistory<T>(history: readonly T[] | undefined, { enabled, incognito }: { enabled: boolean; incognito: boolean }): readonly T[] {
  return enabled && !incognito ? (history ?? NO_HOME_HISTORY) : NO_HOME_HISTORY;
}
