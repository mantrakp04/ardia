import {
  allEngines,
  controllingExtensionEngine,
  engineById,
  extensionEngineId,
  makeCustomEngine,
  resolveInput,
  validateEngine,
  type CustomSearchEngine,
  type EngineInput,
  type ExtensionSearchEngine,
  type SearchEngine,
} from "@ardia/core";
import type { StateCreator } from "zustand";
import { fromLegacyUrl } from "../../lib/legacy";
import type { BrowserState } from "../browser/store";
import { DEFAULT_SIDEBAR_WIDTH } from "../../lib/windowLayout";
import { isFields, isString, isStringList } from "../../lib/decode";

export const DEFAULT_PROFILE_ID = "default";

export type SettingSpec<T> = { default: T; valid: (value: unknown) => boolean; synced: boolean; values?: readonly T[] };

const SYNCED = true;

const isRecordOf = (v: unknown, item: (x: unknown) => boolean) => isFields(v) && Object.values(v).every(item);
const isWidth = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const hasStrings = (v: unknown, keys: readonly string[]) => isFields(v) && keys.every((k) => isString(v[k]));

const flag = (d: boolean, synced = false): SettingSpec<boolean> => ({ default: d, valid: (v) => typeof v === "boolean", synced });
const text = (d: string, synced = false): SettingSpec<string> => ({ default: d, valid: isString, synced });
const width = (d: number): SettingSpec<number> => ({ default: d, valid: isWidth, synced: false });
const oneOf = <const V extends readonly string[]>(values: V, d: V[number], synced = false): SettingSpec<V[number]> & { values: V } => ({
  default: d,
  values,
  valid: (v) => values.includes(v as string),
  synced,
});
const shaped = <T,>(d: T, valid: (v: unknown) => boolean, synced = false): SettingSpec<T> => ({ default: d, valid, synced });

export const SETTING_SPECS = {
  warnBeforeQuitting: flag(false, SYNCED),
  warnBeforeClosingWindow: flag(true, SYNCED),
  restoreSession: flag(true),
  searchEngine: text("google", SYNCED),
  customSearchUrl: text("", SYNCED),
  customSearchEngines: shaped<CustomSearchEngine[]>([], (v) => Array.isArray(v) && v.every((e) => hasStrings(e, ["id", "name", "keyword", "url"])), SYNCED),
  extensionSearchEngines: shaped<ExtensionSearchEngine[]>([], (v) => Array.isArray(v) && v.every((e) => hasStrings(e, ["profile", "extensionId", "name", "keyword", "url"]))),
  searchSuggestions: flag(true, SYNCED),
  showSelectionSearch: flag(true, SYNCED),
  commandBarPreference: oneOf(["website", "search"], "website", SYNCED),
  tabLayout: oneOf(["sidebar", "top"], "sidebar", SYNCED),
  hideToolbarWhileScrolling: flag(true, SYNCED),
  newTabPosition: oneOf(["top", "bottom", "nextToCurrent"], "bottom", SYNCED),
  newTabButtonPosition: oneOf(["top", "bottom"], "bottom", SYNCED),
  newTabOpens: oneOf(["page", "commandBar"], "page", SYNCED),
  warnBeforeClosingLastTab: flag(true, SYNCED),
  undoReopensClosedTab: flag(false, SYNCED),
  warnBeforeMovingTabsToProfile: flag(true, SYNCED),
  shareTabsAcrossWindows: flag(false),
  tabReorderHaptics: flag(true, SYNCED),
  extendWebsiteColor: flag(true, SYNCED),
  cmdClickCreatesTabGroup: flag(true, SYNCED),
  optShiftClickOpensInGroup: flag(true, SYNCED),
  peekModifier: oneOf(["alt", "shift", "off"], "shift", SYNCED),
  peekLinksToOtherSites: flag(false, SYNCED),
  splitLinkModifier: oneOf(["altShift", "alt"], "altShift", SYNCED),
  autoGroupMeetingTabs: flag(true, SYNCED),
  cleanUpInactiveTabsAfterMinutes: shaped<number | null>(null, (v) => v === null || isWidth(v), SYNCED),
  mutedSites: shaped<string[]>([], isStringList, SYNCED),
  neverTranslateSites: shaped<Record<string, string[]>>({}, (v) => isRecordOf(v, isStringList)),
  autoPictureInPicture: flag(true, SYNCED),
  commandScrollZoom: flag(true, SYNCED),
  videoUpscaling: flag(true, SYNCED),
  sidebarMediaControls: flag(true, SYNCED),
  sidebarWidth: width(DEFAULT_SIDEBAR_WIDTH),
  showSidebarButton: flag(true, SYNCED),
  showClearButton: flag(true, SYNCED),
  balancedTopApps: flag(false, SYNCED),
  pinnedTabsGlass: flag(true, SYNCED),
  pinnedTabIconRing: flag(false, SYNCED),
  showAdvancedSettings: flag(false),
  selectedTabGlow: oneOf(["full", "soft", "off"], "full", SYNCED),
  pageScrollBars: oneOf(["system", "thin"], "system", SYNCED),
  fadeUnloadedTabs: flag(false, SYNCED),
  warnBeforeClosingTabGroup: flag(true, SYNCED),
  batterySaverWhen: oneOf(["lowBattery", "unplugged", "never"], "lowBattery"),
  memorySaver: flag(true),
  memorySaverMode: oneOf(["moderate", "balanced", "maximum"], "balanced"),
  keepActiveSites: shaped<string[]>([], isStringList, SYNCED),
  extensionSidePanelWidth: width(360),
  showFullUrl: flag(false, SYNCED),
  allowJavaScriptFromAppleEvents: flag(false),
  cliControl: flag(false),
  bookmarksBar: oneOf(["always", "newTab", "never"], "never", SYNCED),
  bookmarksBarSize: oneOf(["default", "large"], "default", SYNCED),
  hideBookmarksBarImport: flag(false),
  appearance: oneOf(["auto", "light", "dark"], "auto", SYNCED),
  addressBar: oneOf(["toolbar", "sidebar"], "toolbar", SYNCED),
  compactToolbar: flag(false, SYNCED),
  commandBarPlacement: oneOf(["field", "centred"], "field", SYNCED),
  spacesFollowAppearance: flag(true),
  defaultProfileId: text(DEFAULT_PROFILE_ID),
  profileSwitcherIcons: flag(false, SYNCED),
  shortcuts: shaped<Record<string, string[]>>({}, (v) => isRecordOf(v, isStringList), SYNCED),
  openLinksInLittleArdia: flag(true),
  littleArdiaSize: shaped<[number, number]>([900, 640], (v) => Array.isArray(v) && v.length === 2 && v.every(isWidth)),
  pageEngine: oneOf(["chromium", "webkit"], "chromium"),
  websiteEngines: shaped<Record<string, "chromium" | "webkit">>({}, (v) => isRecordOf(v, (e) => e === "chromium" || e === "webkit")),
  protectedVideoInWebKit: flag(true),
};

type Specs = typeof SETTING_SPECS;
export type SettingKey = keyof Specs;
export const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

export type Settings = { -readonly [K in SettingKey]: Specs[K]["default"] } & { chosen: string[]; inferred: string[] };

export type SearchEngineId = string;
export type BatterySaverWhen = Settings["batterySaverWhen"];
export type SelectedTabGlow = Settings["selectedTabGlow"];
export type PeekModifier = Settings["peekModifier"];
export type SplitLinkModifier = Settings["splitLinkModifier"];

export const splitLinkModifierOf = (settings: Pick<Settings, "peekModifier" | "splitLinkModifier">): SplitLinkModifier =>
  settings.splitLinkModifier === "alt" && settings.peekModifier === "alt" ? "altShift" : settings.splitLinkModifier;

export function withLinkKeysApart(settings: Settings, patch: Partial<Settings>): Partial<Settings> {
  if ((patch.peekModifier ?? settings.peekModifier) !== "alt" || (patch.splitLinkModifier ?? settings.splitLinkModifier) !== "alt") return patch;
  return "splitLinkModifier" in patch && !("peekModifier" in patch) ? { ...patch, peekModifier: "shift" } : { ...patch, splitLinkModifier: "altShift" };
}

export const DEFAULT_SETTINGS: Settings = {
  ...(Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTING_SPECS[key].default])) as Omit<Settings, "chosen" | "inferred">),
  chosen: [],
  inferred: [],
};

export function parseSettings(raw: unknown): Settings {
  const saved = isFields(raw) ? raw : {};
  const value = (key: SettingKey) => (SETTING_SPECS[key].valid(saved[key]) ? saved[key] : SETTING_SPECS[key].default);
  const legacy = isFields(raw) && !raw.chosen ? Object.keys(raw) : null;
  const settings = {
    ...(Object.fromEntries(SETTING_KEYS.map((key) => [key, value(key)])) as Omit<Settings, "chosen" | "inferred">),
    chosen: legacy ?? (isStringList(saved.chosen) ? saved.chosen : []),
    inferred: legacy ?? (isStringList(saved.inferred) ? saved.inferred : []),
  };
  return { ...settings, ...withLinkKeysApart(settings, {}) };
}

export const validSettingValue = (key: SettingKey, value: unknown) => SETTING_SPECS[key].valid(value);

const engineCache = new WeakMap<
  CustomSearchEngine[],
  { legacyUrl: string; extension: ExtensionSearchEngine[]; engines: SearchEngine[] }
>();

export function searchEngines(settings: Settings): SearchEngine[] {
  const custom = settings.customSearchEngines;
  const extension = settings.extensionSearchEngines;
  const cached = engineCache.get(custom);
  if (cached && cached.legacyUrl === settings.customSearchUrl && cached.extension === extension) return cached.engines;
  const engines = allEngines(custom, extension);
  if (settings.customSearchUrl.includes("%s")) {
    const at = engines.findIndex((e) => e.extension);
    engines.splice(at < 0 ? engines.length : at, 0, { id: "custom", name: "Custom", keyword: "custom", url: settings.customSearchUrl, custom: true });
  }
  engineCache.set(custom, { legacyUrl: settings.customSearchUrl, extension, engines });
  return engines;
}

export function controllingSearchExtension(settings: Settings): ExtensionSearchEngine | undefined {
  return controllingExtensionEngine(settings.extensionSearchEngines);
}

export function defaultSearchEngine(settings: Settings): SearchEngine {
  const controlling = controllingSearchExtension(settings);
  return engineById(searchEngines(settings), controlling ? extensionEngineId(controlling.extensionId) : settings.searchEngine);
}

export function searchUrlPrefix(settings: Settings): string {
  return defaultSearchEngine(settings).url;
}

export const resolveTyped = (settings: Settings, input: string): string => resolveInput(fromLegacyUrl(input.trim()), searchUrlPrefix(settings));

function validateCustomEngine(settings: Settings, input: EngineInput, ignoreId?: string): string | null {
  return validateEngine(input, searchEngines(settings), ignoreId);
}

export function choose(settings: Settings, patch: Partial<Settings>): Settings {
  const added = Object.keys(patch).filter((k) => k !== "chosen" && k !== "inferred" && !settings.chosen.includes(k));
  return { ...settings, ...patch, chosen: added.length ? [...settings.chosen, ...added] : settings.chosen, inferred: settings.inferred.filter((k) => !(k in patch)) };
}

export function migrateSavedSettings(saved: (Partial<Settings> & { batterySaver?: unknown }) | undefined): Partial<Settings> | undefined {
  return withNewTabButtonPosition(withoutBatterySaver(saved));
}

function withNewTabButtonPosition(saved: Partial<Settings> | undefined): Partial<Settings> | undefined {
  if (!saved || saved.newTabButtonPosition !== undefined || saved.newTabPosition !== "top") return saved;
  const alongside = (keys: string[]) => (keys.includes("newTabPosition") ? [...new Set([...keys, "newTabButtonPosition"])] : keys);
  return {
    ...saved,
    newTabButtonPosition: "top",
    ...(saved.chosen ? { chosen: alongside(saved.chosen) } : {}),
    ...(saved.inferred ? { inferred: alongside(saved.inferred) } : {}),
  };
}

function withoutBatterySaver(saved: (Partial<Settings> & { batterySaver?: unknown }) | undefined): Partial<Settings> | undefined {
  if (!saved || !("batterySaver" in saved)) return saved;
  const { batterySaver, ...rest } = saved;
  const explicit = batterySaver === false || (batterySaver === true && !!rest.chosen?.includes("batterySaver") && !rest.inferred?.includes("batterySaver"));
  const without = (keys: string[]) => keys.filter((k) => k !== "batterySaver");
  return {
    ...rest,
    ...(rest.chosen ? { chosen: explicit ? [...new Set([...without(rest.chosen), "batterySaverWhen"])] : without(rest.chosen) } : {}),
    ...(rest.inferred ? { inferred: without(rest.inferred) } : {}),
    ...(explicit && rest.batterySaverWhen === undefined ? { batterySaverWhen: batterySaver ? "unplugged" : "never" } : {}),
  };
}

export type SettingsSlice = {
  settings: Settings;
  updateSettings(patch: Partial<Settings>, options?: { fromSync?: boolean }): void;
  setSearchEngine(id: string): void;
  addCustomEngine(input: EngineInput): { id: string } | { error: string };
  updateCustomEngine(id: string, input: EngineInput): string | null;
  removeCustomEngine(id: string): void;
};

let engineCounter = 0;
const newEngineId = () => `engine-${Date.now().toString(36)}-${(++engineCounter).toString(36)}`;

export const createSettingsSlice: StateCreator<BrowserState, [], [], SettingsSlice> = (set, get) => ({
  settings: DEFAULT_SETTINGS,
  updateSettings(patch, { fromSync = false } = {}) {
    set((s) => ({ settings: fromSync ? { ...s.settings, ...patch } : choose(s.settings, withLinkKeysApart(s.settings, patch)) }));
  },

  setSearchEngine(id) {
    if (searchEngines(get().settings).some((e) => e.id === id)) get().updateSettings({ searchEngine: id });
  },

  addCustomEngine(input) {
    const { settings } = get();
    const error = validateCustomEngine(settings, input);
    if (error) return { error };
    const engine = makeCustomEngine(input, newEngineId());
    get().updateSettings({ customSearchEngines: [...settings.customSearchEngines, engine] });
    return { id: engine.id };
  },

  updateCustomEngine(id, input) {
    const { settings } = get();
    if (!settings.customSearchEngines.some((e) => e.id === id)) return "This search engine no longer exists.";
    const error = validateCustomEngine(settings, input, id);
    if (error) return error;
    get().updateSettings({ customSearchEngines: settings.customSearchEngines.map((e) => (e.id === id ? makeCustomEngine(input, id) : e)) });
    return null;
  },

  removeCustomEngine(id) {
    const { settings } = get();
    get().updateSettings({
      customSearchEngines: settings.customSearchEngines.filter((e) => e.id !== id),
      ...(settings.searchEngine === id ? { searchEngine: DEFAULT_SETTINGS.searchEngine } : {}),
    });
  },
});
