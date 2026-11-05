import { call, on } from "./engine/call";

export type EngineHistoryEntry = { url: string; title: string; visits: number; visitTimes: number[] };

export type HistoryChange =
  | { kind: "visit"; profile: string; url: string; title: string; visits: number; at: number }
  | { kind: "modified"; profile: string; rows: { url: string; title: string; visits: number }[] }
  | { kind: "deleted"; profile: string; all: boolean; urls: string[] };

export type HistoryWireRow = { u: string; t: string; n: number };

type HistoryWireChange =
  | ({ kind: "visit"; at: number } & HistoryWireRow)
  | { kind: "modified"; rows: HistoryWireRow[] }
  | { kind: "deleted"; all: boolean; urls: string[] };

export type HistoryChangedBatch = { profile: string; kind: "batch"; changes: HistoryWireChange[] };

export async function queryHistory(profile: string, maxUrls = 5000, maxVisits = 50): Promise<EngineHistoryEntry[]> {
  const { entries } = await call("history.query", { profile, maxUrls, maxVisits });
  return entries.map((e) => ({ url: e.u, title: e.t, visits: e.n, visitTimes: e.v }));
}

const adding = new Map<string, Promise<unknown>>();

export function addHistoryVisits(profile: string, pages: { url: string; title: string; visitTimes: number[] }[], toleranceMs = 1000) {
  if (!pages.length) return Promise.resolve(0);
  const run = (adding.get(profile) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      call("history.add", { profile, pages: pages.map((p) => ({ u: p.url, t: p.title, v: p.visitTimes })), toleranceMs }),
    )
    .then((r) => r.added);
  adding.set(profile, run);
  return run;
}

export const importHistoryRows = (profile: string, rows: { url: string; title: string; visits: number; lastVisit: number }[]) =>
  rows.length
    ? call("history.import", { profile, rows: rows.map((r) => ({ u: r.url, t: r.title, n: r.visits, l: r.lastVisit })) })
    : Promise.resolve();

export const deleteHistoryUrls = (profile: string, urls: string[]) =>
  urls.length ? call("history.deleteUrls", { profile, urls }) : Promise.resolve();

export const watchHistory = (profile: string) => call("history.watch", { profile });

const historyChange = (profile: string, c: HistoryWireChange): HistoryChange =>
  c.kind === "visit"
    ? { kind: "visit", profile, url: c.u, title: c.t, visits: c.n, at: c.at }
    : c.kind === "modified"
      ? { kind: "modified", profile, rows: c.rows.map((r) => ({ url: r.u, title: r.t, visits: r.n })) }
      : { kind: "deleted", profile, all: c.all, urls: c.urls };

export const onHistoryChanged = (listener: (change: HistoryChange) => void) =>
  on("history.changed", ({ profile, changes }) => {
    for (const c of changes) listener(historyChange(profile, c));
  });
