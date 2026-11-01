import { deleteHistoryUrls, importHistoryRows } from "../../platform/history";
import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { engineProfileForSpace, isIncognitoSpace } from "../browser/model";
import { engineSpaces } from "../spaces/engineSpaces";
import type { HistoryEntry } from "../browser/types";
import { isWebPageUrl } from "../../lib/url";

export type HistoryView = { list: HistoryEntry[]; floor: number; ready: boolean };

export type HistorySlice = {
  history: Record<string, HistoryView>;

  removeHistory(spaceId: string, urls: string[]): void;
  clearHistory(spaceId: string, since?: number): void;
  importHistory(spaceId: string, entries: Omit<HistoryEntry, "favicon">[]): number;
};

export const MAX_HISTORY = 5000;
export const MAX_VISIT_TIMES = 50;

export const NO_HISTORY: HistoryEntry[] = [];

type HistoryState = Pick<BrowserState, "spaces" | "profiles" | "history">;

export const historyViewOf = (s: HistoryState, spaceId: string): HistoryView | undefined =>
  s.spaces[spaceId] && s.profiles[s.spaces[spaceId]!.profileId] ? s.history[engineProfileForSpace(s, spaceId)] : undefined;

export const historyOf = (s: HistoryState, spaceId: string): HistoryEntry[] => historyViewOf(s, spaceId)?.list ?? NO_HISTORY;

export function withHistoryList(s: HistoryState, engine: string, list: HistoryEntry[]): Partial<Pick<BrowserState, "history">> {
  if (!engineSpaces(s).includes(engine)) return {};
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

const failed = (what: string) => (error: unknown) => console.warn(`[history] ${what}`, error);

export const createHistorySlice: StateCreator<BrowserState, [], [], HistorySlice> = (set, get) => ({
  history: {},

  removeHistory(spaceId, urls) {
    if (!urls.length || isIncognitoSpace(spaceId)) return;
    set((s) => withHistoryList(s, engineProfileForSpace(s, spaceId), historyOf(s, spaceId).filter((h) => !urls.includes(h.url))));
    void deleteHistoryUrls(engineProfileForSpace(get(), spaceId), urls).catch(failed("delete"));
  },

  importHistory(spaceId, entries) {
    if (isIncognitoSpace(spaceId)) return 0;
    const rows = entries.filter((e) => isWebPageUrl(e.url));
    let added = 0;
    set((s) => {
      const byUrl = new Map(historyOf(s, spaceId).map((h) => [h.url, h]));
      for (const e of rows) {
        const existing = byUrl.get(e.url);
        if (existing) continue;
        added++;
        byUrl.set(e.url, { url: e.url, title: e.title, favicon: null, visits: Math.max(1, e.visits), lastVisit: e.lastVisit, visitTimes: [e.lastVisit] });
      }
      const merged = [...byUrl.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
      return withHistoryList(s, engineProfileForSpace(s, spaceId), merged);
    });
    void importHistoryRows(engineProfileForSpace(get(), spaceId), rows).catch(failed("import"));
    return added;
  },

  clearHistory(spaceId, since) {
    if (isIncognitoSpace(spaceId)) return;
    set((s) => {
      const engine = engineProfileForSpace(s, spaceId);
      if (since === undefined) return withHistoryList(s, engine, []);
      const kept = historyOf(s, spaceId).map((h) => withoutVisitsSince(h, since)).filter((h): h is HistoryEntry => !!h);
      return withHistoryList(s, engine, kept.sort((a, b) => b.lastVisit - a.lastVisit));
    });
  },
});
