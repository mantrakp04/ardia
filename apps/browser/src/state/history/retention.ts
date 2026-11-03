import { expireHistoryBefore } from "../../platform/history";
import { everySlowly } from "../../platform/slowTimers";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { useBrowser } from "../browser/store";
import { engineProfiles } from "../profiles/engineProfiles";
import type { Settings } from "../settings/settings";

export type KeepHistory = Settings["keepHistory"];

export const DAY_MS = 86_400_000;

const KEPT_DAYS: Record<KeepHistory, number> = { forever: Infinity, year: 365, threeMonths: 90, month: 30 };

export const historyCutoff = (keep: KeepHistory, now: number): number | null => (keep === "forever" ? null : now - KEPT_DAYS[keep] * DAY_MS);

export const shortensHistory = (from: KeepHistory, to: KeepHistory) => KEPT_DAYS[to] < KEPT_DAYS[from];

const store = () => useBrowser.getState();

const failed = (engine: string) => (error: unknown) => console.warn(`[history] couldn't delete old history (${engine || "original profile"})`, error);

export async function expireOldHistory(now = Date.now()): Promise<string[]> {
  const s = store();
  const before = historyCutoff(s.settings.keepHistory, now);
  if (before === null) return [];
  const engines = engineProfiles(s);
  s.trimHistoryBefore(before);
  await Promise.all(engines.map((engine) => expireHistoryBefore(engine, before).catch(failed(engine))));
  return engines;
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
