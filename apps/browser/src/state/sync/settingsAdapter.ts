import { canonical, type Adapter, type SyncRecord } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings";
import { fromLegacy } from "../../lib/legacy";
import { CLEAN_UP_KEY, hoursFromMinutes, LEGACY_CLEAN_UP_KEY, minutesFromHours } from "../settings/cleanUpAfter";

const store = () => useBrowser.getState();
const recordKey = (name: string) => `set:${name === CLEAN_UP_KEY ? LEGACY_CLEAN_UP_KEY : name}`;
const settingOf = (key: string) => (key.slice(4) === LEGACY_CLEAN_UP_KEY ? CLEAN_UP_KEY : key.slice(4));
const toRecord = (name: string, value: unknown) => (name === CLEAN_UP_KEY ? hoursFromMinutes(value as number | null) : value);
const fromRecord = (name: string, value: unknown) => (name === CLEAN_UP_KEY ? minutesFromHours(value) : value);

export const SYNCED_SETTINGS = [
  "warnBeforeQuitting",
  "warnBeforeClosingWindow",
  "searchEngine",
  "customSearchUrl",
  "customSearchEngines",
  "searchSuggestions",
  "showSelectionSearch",
  "commandBarPreference",
  "tabLayout",
  "hideToolbarWhileScrolling",
  "showSidebarButton",
  "showClearButton",
  "balancedTopApps",
  "pinnedTabIconRing",
  "selectedTabGlow",
  "pageScrollBars",
  "fadeUnloadedTabs",
  "warnBeforeClosingTabGroup",
  "newTabPosition",
  "newTabButtonPosition",
  "newTabOpens",
  "warnBeforeClosingLastTab",
  "undoReopensClosedTab",
  "warnBeforeMovingTabsToProfile",
  "tabReorderHaptics",
  "extendWebsiteColor",
  "cmdClickCreatesTabGroup",
  "optShiftClickOpensInGroup",
  "peekModifier",
  "splitLinkModifier",
  "autoGroupMeetingTabs",
  "cleanUpInactiveTabsAfterMinutes",
  "mutedSites",
  "autoPictureInPicture",
  "commandScrollZoom",
  "videoUpscaling",
  "sidebarMediaControls",
  "profileSwitcherIcons",
  "showFullUrl",
  "bookmarksBar",
  "appearance",
  "showPageFrame",
  "addressBar",
  "compactToolbar",
  "commandBarPlacement",
  "shortcuts",
] as const satisfies readonly (keyof Settings)[];

export const settingsAdapter: Adapter = {
  prefix: "set:",
  adoptRemoteOnJoin: true,
  extract: (base) => {
    const settings = store().settings;
    const chosen = new Set(settings.chosen ?? []);
    const inferred = new Set(settings.inferred ?? []);
    const filledIn = (name: (typeof SYNCED_SETTINGS)[number], value: unknown) => {
      if (!inferred.has(name) || JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[name])) return false;
      const last = base(recordKey(name)) as { v?: unknown } | undefined;
      return last === undefined || last.v === null || last.v === undefined;
    };
    const values = new Map<string, unknown>();
    for (const name of SYNCED_SETTINGS) {
      const value = settings[name] as unknown;
      if (!chosen.has(name) || value === undefined || (value === null && DEFAULT_SETTINGS[name] !== null) || filledIn(name, value)) continue;
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
      if (value === undefined || (value === null && DEFAULT_SETTINGS[name as keyof Settings] !== null)) continue;
      patch[name] = value;
    }
    if (Object.keys(patch).length) store().updateSettings(patch as Partial<Settings>, { fromSync: true });
  },
};

export function settingsToReapply(records: Record<string, SyncRecord>): string[] {
  const settings = store().settings;
  const chosen = new Set(settings.chosen ?? []);
  return SYNCED_SETTINGS.flatMap((name) => {
    const key = recordKey(name);
    const value = fromRecord(name, (fromLegacy(records[key]?.v) as { v?: unknown } | null | undefined)?.v);
    if (chosen.has(name) || value === undefined || (value === null && DEFAULT_SETTINGS[name] !== null)) return [];
    return canonical(value) === canonical(settings[name]) ? [] : [key];
  });
}
