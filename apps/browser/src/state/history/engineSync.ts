import { addHistoryVisits, onHistoryChanged, queryHistory, watchHistory, type EngineHistoryEntry, type HistoryChange } from "../../platform/history";
import { readDocument } from "../../platform/documents";
import { useBrowser, type BrowserState } from "../browser/store";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "./history";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import type { HistoryEntry } from "../browser/types";
import { isWebPageUrl } from "../../lib/url";
import { engineProfiles } from "../profiles/engineProfiles";
import { migrateLegacyFile } from "../app/legacyFiles";

const LEGACY_FILE = "history.json";
const LEGACY_TOLERANCE_MS = 60_000;
const CHROME_KEEPS_MS = 90 * 86_400_000;
const CHUNK = 500;
const LEGACY_KEPT_MS = 15_000;

const store = () => useBrowser.getState();


const toEntry = (e: EngineHistoryEntry): HistoryEntry => ({
  url: e.url,
  title: e.title,
  favicon: null,
  visits: e.visits,
  lastVisit: e.visitTimes.length ? e.visitTimes[e.visitTimes.length - 1]! : 0,
  visitTimes: e.visitTimes,
});

const viewOf = (engine: string): HistoryEntry[] => store().history[engine]?.list ?? [];

let legacyMoved = false;

function setView(engine: string, list: HistoryEntry[], floor?: number) {
  useBrowser.setState((s) => {
    if (!engineProfiles(s).includes(engine)) return {};
    const was = s.history[engine];
    const full = list.length >= MAX_HISTORY ? list[list.length - 1]!.lastVisit : -Infinity;
    const next = { list, floor: Math.max(floor ?? was?.floor ?? -Infinity, full), ready: legacyMoved || !!was?.ready };
    if (was && was.list === next.list && was.floor === next.floor && was.ready === next.ready) return {};
    return { history: { ...s.history, [engine]: next } };
  });
}

const byLastVisit = (a: HistoryEntry, b: HistoryEntry) => b.lastVisit - a.lastVisit;

export function applyHistoryChange(list: HistoryEntry[], change: Exclude<HistoryChange, { kind: "deleted"; all: true }>): HistoryEntry[] {
  switch (change.kind) {
    case "visit": {
      if (!isWebPageUrl(change.url)) return list;
      const oldAt = list.findIndex((h) => h.url === change.url);
      const old = oldAt < 0 ? undefined : list[oldAt];
      if (old?.visitTimes?.includes(change.at)) return list;
      const times = [...(old?.visitTimes ?? []), change.at].sort((a, b) => a - b).slice(-MAX_VISIT_TIMES);
      const entry: HistoryEntry = {
        url: change.url,
        title: change.title || old?.title || "",
        favicon: null,
        visits: Math.max(change.visits, 1),
        lastVisit: times[times.length - 1]!,
        visitTimes: times,
      };
      const next = list.slice();
      if (old) next.splice(oldAt, 1);
      const at = next.findIndex((h) => h.lastVisit <= entry.lastVisit);
      if (at < 0) next.push(entry);
      else next.splice(at, 0, entry);
      if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;
      return next;
    }
    case "modified": {
      let next: HistoryEntry[] | null = null;
      for (const row of new Map(change.rows.map((r) => [r.url, r])).values()) {
        const at = list.findIndex((h) => h.url === row.url);
        const h = at < 0 ? undefined : list[at];
        if (!h || ((row.title === h.title || !row.title) && row.visits === h.visits)) continue;
        next ??= list.slice();
        next[at] = { ...h, title: row.title || h.title, visits: row.visits };
      }
      return next ?? list;
    }
    case "deleted": {
      const gone = new Set(change.urls);
      const next = list.filter((h) => !gone.has(h.url));
      return next.length === list.length ? list : next;
    }
  }
}

type Load = { running: Promise<void>; again: boolean; queued: HistoryChange[] };
const loads = new Map<string, Load>();
const loaded = new Set<string>();
const migrating = new Set<string>();

function load(engine: string): Promise<void> {
  const running = loads.get(engine);
  if (running) {
    running.again = true;
    return running.running;
  }
  const state: Load = { running: Promise.resolve(), again: false, queued: [] };
  loads.set(engine, state);
  state.running = (async () => {
    try {
      do {
        state.again = false;
        state.queued = [];
        await watchHistory(engine);
        const read = await queryHistory(engine, MAX_HISTORY, MAX_VISIT_TIMES);
        const floor = read.length >= MAX_HISTORY ? Math.min(...read.map((e) => e.visitTimes.at(-1) ?? 0)) : -Infinity;
        let list = read.filter((e) => isWebPageUrl(e.url)).map(toEntry).sort(byLastVisit);
        for (const change of state.queued) if (!(change.kind === "deleted" && change.all)) list = applyHistoryChange(list, change);
        if (state.queued.some((c) => c.kind === "deleted" && c.all)) state.again = true;
        setView(engine, list, floor);
        loaded.add(engine);
      } while (state.again);
    } catch (error) {
      console.warn(`[history] couldn't read ${engine || "the default profile"}'s history`, error);
    } finally {
      loads.delete(engine);
    }
  })();
  return state.running;
}

let pending: HistoryChange[] = [];

function changed(change: HistoryChange) {
  if (!pending.length) queueMicrotask(applyPending);
  pending.push(change);
}

function applyPending() {
  const changes = pending;
  pending = [];
  const views = new Map<string, HistoryEntry[]>();
  const show = () => {
    for (const [engine, list] of views) setView(engine, list);
    views.clear();
  };
  for (const change of changes) {
    const engine = change.profile;
    if (migrating.has(engine)) continue;
    const running = loads.get(engine);
    if (running) {
      running.queued.push(change);
      continue;
    }
    if (!loaded.has(engine)) continue;
    if (change.kind === "deleted" && change.all) {
      show();
      void load(engine);
      continue;
    }
    views.set(engine, applyHistoryChange(views.get(engine) ?? viewOf(engine), change));
  }
  show();
}

type LegacyFile = { history?: Record<string, HistoryEntry[]> };

export const migrateHistoryFile = (now = Date.now(), { keepMs = LEGACY_KEPT_MS } = {}) =>
  migrateLegacyFile<LegacyFile>(LEGACY_FILE, "history", (file) => moveHistory(file, now), keepMs);

async function moveHistory(file: LegacyFile, now: number) {
  const s = store();
  const perEngine = new Map<string, HistoryEntry[]>();
  for (const [profileId, list] of Object.entries(file.history ?? {})) {
    if (!s.profiles[profileId] || isIncognitoProfile(profileId) || !Array.isArray(list)) continue;
    const engine = engineProfile(s, profileId);
    if (!perEngine.has(engine)) perEngine.set(engine, list);
  }
  for (const engine of perEngine.keys()) migrating.add(engine);
  try {
    for (const [engine, list] of perEngine) {
      const pages = list
        .filter((e) => e && typeof e.url === "string")
        .map((e) => ({
          url: e.url,
          title: e.title ?? "",
          visitTimes: (e.visitTimes?.length ? e.visitTimes : [e.lastVisit]).filter((t) => typeof t === "number" && t > now - CHROME_KEEPS_MS),
        }))
        .filter((p) => p.visitTimes.length);
      for (let i = 0; i < pages.length; i += CHUNK) await addHistoryVisits(engine, pages.slice(i, i + CHUNK), LEGACY_TOLERANCE_MS);
    }
  } finally {
    migrating.clear();
  }
}

export function startHistory() {
  const events = onHistoryChanged(changed);
  const loadAll = (s: Pick<BrowserState, "profiles">) => {
    for (const engine of engineProfiles(s)) if (!loaded.has(engine) && !loads.has(engine)) void load(engine);
  };
  let moving = readDocument(LEGACY_FILE) !== null;
  let stopped = false;
  if (!moving) loadAll(store());
  const migrate = () => {
    if (stopped) return;
    void migrateHistoryFile().then((result) => {
      legacyMoved = result !== "kept";
      if (moving) {
        moving = false;
        loadAll(store());
      } else if (result === "moved") void reloadHistory();
      else if (legacyMoved) for (const engine of loaded) setView(engine, viewOf(engine));
    });
  };
  if (moving) afterFirstWindow(migrate);
  else migrate();
  const stop = useBrowser.subscribe((s, prev) => {
    if (s.profiles !== prev.profiles && !moving) loadAll(s);
  });
  return () => {
    stopped = true;
    events.remove();
    stop();
    pending = [];
    loaded.clear();
    legacyMoved = false;
  };
}

export const reloadHistory = () => Promise.all(engineProfiles(store()).map(load));
