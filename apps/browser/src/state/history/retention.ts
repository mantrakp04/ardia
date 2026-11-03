import { expireHistoryBefore } from "../../platform/history";
import { readDocument, writeDocument } from "../../platform/documents";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { everySlowly } from "../../platform/slowTimers";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { useBrowser } from "../browser/store";
import { engineProfiles } from "../profiles/engineProfiles";
import { DAY_MS, historyCutoff, type KeepHistory } from "./history";

const store = () => useBrowser.getState();

export const RETENTION_DOCUMENT = "history-retention.json";
const RETENTION_VERSION = 1;
const RETENTION_MIGRATIONS: Migrations = { 0: unchanged };

export function historyTrimmedBefore(): number {
  const saved = parseSaved(readDocument(RETENTION_DOCUMENT), RETENTION_VERSION, RETENTION_MIGRATIONS);
  const at = saved?.trimmedBefore;
  return typeof at === "number" && Number.isFinite(at) ? at : -Infinity;
}

function noteTrimmedBefore(before: number) {
  if (before > historyTrimmedBefore()) writeDocument(RETENTION_DOCUMENT, versionedJson({ trimmedBefore: before }, RETENTION_VERSION));
}

const expired = (engine: string, before: number) =>
  expireHistoryBefore(engine, before).then(
    () => true,
    (error: unknown) => {
      console.warn(`[history] couldn't delete old history (${engine || "original profile"})`, error);
      return false;
    },
  );

export async function expireOldHistory(now = Date.now()): Promise<string[]> {
  const before = historyCutoff(store().settings.keepHistory, now);
  if (before === null) return [];
  const engines = engineProfiles(store());
  const results = await Promise.all(engines.map((engine) => expired(engine, before)));
  const done = engines.filter((_, i) => results[i]);
  store().trimHistoryBefore(before, done);
  if (done.length === engines.length) noteTrimmedBefore(before);
  return done;
}

export function keepHistoryFor(keep: KeepHistory) {
  store().updateSettings({ keepHistory: keep });
  return expireOldHistory();
}

export function startHistoryRetention() {
  afterFirstWindow(() => void expireOldHistory());
  return everySlowly({
    every: DAY_MS,
    run: () => void expireOldHistory(),
    needed: () => store().settings.keepHistory !== "forever",
    watch: (changed) =>
      useBrowser.subscribe((s, prev) => {
        if (s.settings.keepHistory !== prev.settings.keepHistory) changed();
      }),
  });
}
