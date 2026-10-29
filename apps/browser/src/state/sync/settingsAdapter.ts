import { canonical, type Adapter, type SyncRecord } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { DEFAULT_SETTINGS, SETTING_KEYS, SETTING_SPECS, validSettingValue, type SettingKey, type Settings } from "../settings/settings";
import { fromLegacy } from "../../lib/legacy";
import { CLEAN_UP_KEY, hoursFromMinutes, LEGACY_CLEAN_UP_KEY, minutesFromHours } from "../settings/cleanUpAfter";

const store = () => useBrowser.getState();
const recordKey = (name: string) => `set:${name === CLEAN_UP_KEY ? LEGACY_CLEAN_UP_KEY : name}`;
const settingOf = (key: string) => (key.slice(4) === LEGACY_CLEAN_UP_KEY ? CLEAN_UP_KEY : key.slice(4));
const toRecord = (name: string, value: unknown) => (name === CLEAN_UP_KEY ? hoursFromMinutes(value as number | null) : value);
const fromRecord = (name: string, value: unknown) => (name === CLEAN_UP_KEY ? minutesFromHours(value) : value);

export const SYNCED_SETTINGS = SETTING_KEYS.filter((key) => SETTING_SPECS[key].synced);

export const settingsAdapter: Adapter = {
  prefix: "set:",
  adoptRemoteOnJoin: true,
  extract: (base) => {
    const settings = store().settings;
    const chosen = new Set(store().settingsMeta.chosen);
    const inferred = new Set(store().settingsMeta.inferred);
    const filledIn = (name: SettingKey, value: unknown) => {
      if (!inferred.has(name) || JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[name])) return false;
      const last = base(recordKey(name)) as { v?: unknown } | undefined;
      return last === undefined || last.v === null || last.v === undefined;
    };
    const values = new Map<string, unknown>();
    const fromNewerVersion = (name: SettingKey) => {
      const last = base(recordKey(name)) as { v?: unknown } | undefined;
      return last?.v !== undefined && last.v !== null && !validSettingValue(name, fromRecord(name, last.v));
    };
    for (const name of SYNCED_SETTINGS) {
      const value = settings[name] as unknown;
      if (!chosen.has(name) || filledIn(name, value) || fromNewerVersion(name)) continue;
      values.set(recordKey(name), { v: toRecord(name, value) });
    }
    return { values, ignore: (key) => !values.has(key) };
  },
  apply: (visible, changed) => {
    const patch: Record<string, unknown> = {};
    for (const key of changed) {
      const name = settingOf(key);
      const record = visible.get(key) as { v: unknown } | undefined;
      if (!record || key !== recordKey(name) || !(SYNCED_SETTINGS as readonly string[]).includes(name)) continue;
      const value = fromRecord(name, record.v);
      if (validSettingValue(name as SettingKey, value)) patch[name] = value;
    }
    if (Object.keys(patch).length) store().updateSettings(patch as Partial<Settings>, { fromSync: true });
  },
};

export function settingsToReapply(records: Record<string, SyncRecord>): string[] {
  const settings = store().settings;
  const chosen = new Set(store().settingsMeta.chosen);
  return SYNCED_SETTINGS.flatMap((name) => {
    const key = recordKey(name);
    const value = fromRecord(name, (fromLegacy(records[key]?.v) as { v?: unknown } | null | undefined)?.v);
    if (chosen.has(name) || !validSettingValue(name, value)) return [];
    return canonical(value) === canonical(settings[name]) ? [] : [key];
  });
}
