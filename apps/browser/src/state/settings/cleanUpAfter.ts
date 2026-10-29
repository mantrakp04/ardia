import type { SavedObject } from "../../lib/savedDocument";
import { durationTitle } from "../../lib/time";
import { isFields } from "../../lib/decode";

export const CLEAN_UP_KEY = "cleanUpInactiveTabsAfterMinutes";
export const LEGACY_CLEAN_UP_KEY = "cleanUpInactiveTabsAfterHours";

export const DAILY_CLEAN_UP_MINUTES = 24 * 60;

export const CLEAN_UP_PRESETS: readonly { minutes: number; title: string }[] = [
  { minutes: 12 * 60, title: "12 hours" },
  { minutes: 24 * 60, title: "24 hours" },
  { minutes: 7 * 24 * 60, title: "7 days" },
  { minutes: 30 * 24 * 60, title: "30 days" },
];

export const CUSTOM_CLEAN_UP = "custom";

export function cleanUpChoices(minutes: number): { value: string; title: string }[] {
  const own = CLEAN_UP_PRESETS.some((p) => p.minutes === minutes) ? [] : [{ minutes, title: durationTitle(minutes) }];
  const sorted = [...CLEAN_UP_PRESETS, ...own].sort((a, b) => a.minutes - b.minutes);
  const custom = sorted.indexOf(CLEAN_UP_PRESETS[0]!) + 1;
  const choices = sorted.map((c) => ({ value: String(c.minutes), title: c.title }));
  return [...choices.slice(0, custom), { value: CUSTOM_CLEAN_UP, title: "Custom…" }, ...choices.slice(custom)];
}

export function minutesFromHours(hours: unknown): number | null | undefined {
  if (hours === null) return null;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return undefined;
  return Math.max(1, Math.round(hours * 60));
}

export const hoursFromMinutes = (minutes: number | null): number | null => (minutes === null ? null : minutes / 60);

const renamed = (keys: unknown) => (Array.isArray(keys) ? keys.map((k) => (k === LEGACY_CLEAN_UP_KEY ? CLEAN_UP_KEY : k)) : keys);

export function settingsWithCleanUpMinutes(settings: unknown): unknown {
  if (!isFields(settings) || !(LEGACY_CLEAN_UP_KEY in settings)) return settings;
  const { [LEGACY_CLEAN_UP_KEY]: hours, ...rest } = settings;
  const minutes = minutesFromHours(hours);
  return {
    ...rest,
    ...(minutes !== undefined && !(CLEAN_UP_KEY in rest) ? { [CLEAN_UP_KEY]: minutes } : {}),
    ...("chosen" in rest ? { chosen: renamed(rest.chosen) } : {}),
    ...("inferred" in rest ? { inferred: renamed(rest.inferred) } : {}),
  };
}

export const sessionWithCleanUpMinutes = (doc: SavedObject): SavedObject =>
  "settings" in doc ? { ...doc, settings: settingsWithCleanUpMinutes(doc.settings) } : doc;
