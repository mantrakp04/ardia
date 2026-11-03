import { deleteHistoryUrls, importHistoryRows } from "../../platform/history";
import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { engineProfiles } from "../profiles/engineProfiles";
import type { HistoryEntry } from "../browser/types";
import { isWebPageUrl } from "../../lib/url";
import type { Settings } from "../settings/settings";

export type HistoryView = { list: HistoryEntry[]; floor: number; ready: boolean };

export type HistorySlice = {
  history: Record<string, HistoryView>;

  removeHistory(profileId: string, urls: string[]): void;
  clearHistory(profileId: string, since?: number): void;
  trimHistoryBefore(before: number, engines: string[]): void;
  importHistory(profileId: string, entries: Omit<HistoryEntry, "favicon">[]): number;
};

export const MAX_HISTORY = 5000;
export const MAX_VISIT_TIMES = 50;

export const NO_HISTORY: HistoryEntry[] = [];

export type KeepHistory = Settings["keepHistory"];

export const DAY_MS = 86_400_000;

const KEPT_DAYS: Record<KeepHistory, number> = { forever: Infinity, year: 365, threeMonths: 90, month: 30 };

export const historyCutoff = (keep: KeepHistory, now: number): number | null => (keep === "forever" ? null : now - KEPT_DAYS[keep] * DAY_MS);

export const shortensHistory = (from: KeepHistory, to: KeepHistory) => KEPT_DAYS[to] < KEPT_DAYS[from];

type HistoryState = Pick<BrowserState, "profiles" | "history">;

export const historyViewOf = (s: HistoryState, profileId: string): HistoryView | undefined => s.history[engineProfile(s, profileId)];

export const historyOf = (s: HistoryState, profileId: string): HistoryEntry[] => historyViewOf(s, profileId)?.list ?? NO_HISTORY;

export function withHistoryList(s: HistoryState, engine: string, list: HistoryEntry[]): Partial<Pick<BrowserState, "history">> {
  if (!engineProfiles(s).includes(engine)) return {};
  const was = s.history[engine];
  return { history: { ...s.history, [engine]: { list, floor: was?.floor ?? -Infinity, ready: was?.ready ?? false } } };
}

function withoutVisitsSince(entry: HistoryEntry, since: number): HistoryEntry | null {
  if (entry.lastVisit < since) return entry;
  const times = entry.visitTimes?.length ? entry.visitTimes : [entry.lastVisit];
  const kept = times.filter((t) => t < since);
  if (!kept.length) return null;
  return { ...entry, visits: entry.visits - (times.length - kept.length), lastVisit: kept[kept.length - 1]!, visitTimes: kept };
}

export function withoutVisitsBefore(entry: HistoryEntry, before: number): HistoryEntry | null {
  if (entry.lastVisit < before) return null;
  const times = entry.visitTimes?.length ? entry.visitTimes : [entry.lastVisit];
  const kept = times.filter((t) => t >= before);
  if (!kept.length || kept.length === times.length) return entry;
  return { ...entry, visits: kept.length, visitTimes: kept };
}

const failed = (what: string) => (error: unknown) => console.warn(`[history] ${what}`, error);

export const createHistorySlice: StateCreator<BrowserState, [], [], HistorySlice> = (set, get) => ({
  history: {},

  removeHistory(profileId, urls) {
    if (!urls.length || isIncognitoProfile(profileId)) return;
    set((s) => withHistoryList(s, engineProfile(s, profileId), historyOf(s, profileId).filter((h) => !urls.includes(h.url))));
    void deleteHistoryUrls(engineProfile(get(), profileId), urls).catch(failed("delete"));
  },

  importHistory(profileId, entries) {
    if (isIncognitoProfile(profileId)) return 0;
    const cutoff = historyCutoff(get().settings.keepHistory, Date.now()) ?? -Infinity;
    const rows = entries.filter((e) => isWebPageUrl(e.url) && e.lastVisit >= cutoff);
    let added = 0;
    set((s) => {
      const byUrl = new Map(historyOf(s, profileId).map((h) => [h.url, h]));
      for (const e of rows) {
        const existing = byUrl.get(e.url);
        if (existing) continue;
        added++;
        byUrl.set(e.url, { url: e.url, title: e.title, favicon: null, visits: Math.max(1, e.visits), lastVisit: e.lastVisit, visitTimes: [e.lastVisit] });
      }
      const merged = [...byUrl.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
      return withHistoryList(s, engineProfile(s, profileId), merged);
    });
    void importHistoryRows(engineProfile(get(), profileId), rows).catch(failed("import"));
    return added;
  },

  clearHistory(profileId, since) {
    if (isIncognitoProfile(profileId)) return;
    set((s) => {
      const engine = engineProfile(s, profileId);
      if (since === undefined) return withHistoryList(s, engine, []);
      const kept = historyOf(s, profileId).map((h) => withoutVisitsSince(h, since)).filter((h): h is HistoryEntry => !!h);
      return withHistoryList(s, engine, kept.sort((a, b) => b.lastVisit - a.lastVisit));
    });
  },

  trimHistoryBefore(before, engines) {
    set((s) => {
      let next: HistoryState = s;
      for (const engine of engines) {
        const list = next.history[engine]?.list;
        if (!list) continue;
        const kept = list.map((h) => withoutVisitsBefore(h, before)).filter((h): h is HistoryEntry => !!h);
        if (kept.length !== list.length || kept.some((h, i) => h !== list[i])) next = { ...next, ...withHistoryList(next, engine, kept) };
      }
      return next === s ? {} : { history: next.history };
    });
  },
});
