import {
  allEngines,
  controllingExtensionEngine,
  engineById,
  extensionEngineId,
  makeCustomEngine,
  validateEngine,
  type CustomSearchEngine,
  type EngineInput,
  type ExtensionSearchEngine,
  type SearchEngine,
} from "@ardia/core";
import type { PageEngine } from "../../platform/tabs";
import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";

export type SearchEngineId = string;

export type BatterySaverWhen = "lowBattery" | "unplugged" | "never";

export type Settings = {
  warnBeforeQuitting: boolean;
  warnBeforeClosingWindow: boolean;
  restoreSession: boolean;
  searchEngine: SearchEngineId;
  customSearchUrl: string;
  customSearchEngines: CustomSearchEngine[];
  extensionSearchEngines: ExtensionSearchEngine[];
  searchSuggestions: boolean;
  showSelectionSearch: boolean;
  commandBarPreference: "website" | "search";

  tabLayout: "sidebar" | "top";
  hideToolbarWhileScrolling: boolean;
  newTabPosition: "top" | "bottom" | "nextToCurrent";
  newTabButtonPosition: "top" | "bottom";
  newTabOpens: "page" | "commandBar";
  warnBeforeClosingLastTab: boolean;
  undoReopensClosedTab: boolean;
  warnBeforeMovingTabsToProfile: boolean;
  shareTabsAcrossWindows: boolean;
  tabReorderHaptics: boolean;
  extendWebsiteColor: boolean;
  cmdClickCreatesTabGroup: boolean;
  optShiftClickOpensInGroup: boolean;
  peekModifier: PeekModifier;
  splitLinkModifier: SplitLinkModifier;
  autoGroupMeetingTabs: boolean;
  cleanUpInactiveTabsAfterHours: number | null;
  mutedSites: string[];
  neverTranslateSites: Record<string, string[]>;
  autoPictureInPicture: boolean;
  videoUpscaling: boolean;
  sidebarMediaControls: boolean;
  sidebarWidth: number;
  showSidebarButton: boolean;
  showClearButton: boolean;
  balancedTopApps: boolean;
  pinnedTabIconRing: boolean;
  selectedTabGlow: SelectedTabGlow;
  pageScrollBars: "system" | "thin";
  fadeUnloadedTabs: boolean;
  warnBeforeClosingTabGroup: boolean;
  batterySaverWhen: BatterySaverWhen;
  extensionSidePanelWidth: number;

  showFullUrl: boolean;
  allowJavaScriptFromAppleEvents: boolean;
  cliControl: boolean;
  bookmarksBar: "always" | "newTab" | "never";
  hideBookmarksBarImport: boolean;

  appearance: "auto" | "light" | "dark";
  addressBar: "toolbar" | "sidebar";
  commandBarPlacement: "field" | "centred";
  spacesFollowAppearance: boolean;

  defaultProfileId: string;

  shortcuts: Record<string, string[]>;

  openLinksInLittleArdia: boolean;
  littleArdiaSize: [number, number];

  pageEngine: PageEngine;
  websiteEngines: Record<string, PageEngine>;
  protectedVideoInWebKit: boolean;

  chosen?: string[];
  inferred?: string[];
};

export type SelectedTabGlow = "full" | "soft" | "off";

export type PeekModifier = "alt" | "shift" | "off";
export const PEEK_MODIFIERS: readonly PeekModifier[] = ["alt", "shift", "off"];
export const peekModifierOf = (settings: Pick<Settings, "peekModifier">): PeekModifier =>
  PEEK_MODIFIERS.includes(settings.peekModifier) ? settings.peekModifier : DEFAULT_SETTINGS.peekModifier;

export type SplitLinkModifier = "altShift" | "alt";
export const splitLinkModifierOf = (settings: Pick<Settings, "peekModifier" | "splitLinkModifier">): SplitLinkModifier =>
  settings.splitLinkModifier === "alt" && peekModifierOf(settings) !== "alt" ? "alt" : "altShift";

export function withLinkKeysApart(settings: Settings, patch: Partial<Settings>): Partial<Settings> {
  if (patch.peekModifier === "alt" && !("splitLinkModifier" in patch) && settings.splitLinkModifier === "alt") return { ...patch, splitLinkModifier: "altShift" };
  if (patch.splitLinkModifier === "alt" && !("peekModifier" in patch) && peekModifierOf(settings) === "alt") return { ...patch, peekModifier: "shift" };
  return patch;
}

export const DEFAULT_PROFILE_ID = "default";

export const DEFAULT_SETTINGS: Settings = {
  warnBeforeQuitting: false,
  warnBeforeClosingWindow: true,
  restoreSession: true,
  searchEngine: "google",
  customSearchUrl: "",
  customSearchEngines: [],
  extensionSearchEngines: [],
  searchSuggestions: true,
  showSelectionSearch: true,
  commandBarPreference: "website",
  tabLayout: "sidebar",
  hideToolbarWhileScrolling: true,
  newTabPosition: "bottom",
  newTabButtonPosition: "bottom",
  newTabOpens: "page",
  warnBeforeClosingLastTab: true,
  undoReopensClosedTab: false,
  warnBeforeMovingTabsToProfile: true,
  shareTabsAcrossWindows: false,
  tabReorderHaptics: true,
  extendWebsiteColor: true,
  cmdClickCreatesTabGroup: true,
  optShiftClickOpensInGroup: true,
  peekModifier: "shift",
  splitLinkModifier: "altShift",
  autoGroupMeetingTabs: true,
  cleanUpInactiveTabsAfterHours: null,
  mutedSites: [],
  neverTranslateSites: {},
  autoPictureInPicture: true,
  videoUpscaling: true,
  sidebarMediaControls: true,
  sidebarWidth: 190,
  showSidebarButton: true,
  showClearButton: true,
  balancedTopApps: false,
  pinnedTabIconRing: false,
  selectedTabGlow: "full",
  pageScrollBars: "system",
  fadeUnloadedTabs: false,
  warnBeforeClosingTabGroup: true,
  batterySaverWhen: "lowBattery",
  extensionSidePanelWidth: 360,
  showFullUrl: false,
  allowJavaScriptFromAppleEvents: false,
  cliControl: false,
  bookmarksBar: "never",
  hideBookmarksBarImport: false,
  appearance: "auto",
  addressBar: "toolbar",
  commandBarPlacement: "field",
  spacesFollowAppearance: true,
  defaultProfileId: DEFAULT_PROFILE_ID,
  shortcuts: {},
  openLinksInLittleArdia: true,
  littleArdiaSize: [900, 640],
  pageEngine: "chromium",
  websiteEngines: {},
  protectedVideoInWebKit: true,
};

const NO_CUSTOM_ENGINES: CustomSearchEngine[] = [];
const NO_EXTENSION_ENGINES: ExtensionSearchEngine[] = [];
const engineCache = new WeakMap<
  CustomSearchEngine[],
  { legacyUrl: string; extension: ExtensionSearchEngine[]; engines: SearchEngine[] }
>();

export function searchEngines(settings: Settings): SearchEngine[] {
  const custom = settings.customSearchEngines ?? NO_CUSTOM_ENGINES;
  const extension = settings.extensionSearchEngines ?? NO_EXTENSION_ENGINES;
  const cached = engineCache.get(custom);
  if (cached && cached.legacyUrl === settings.customSearchUrl && cached.extension === extension) return cached.engines;
  const engines = allEngines(custom, extension);
  if (settings.customSearchUrl?.includes("%s")) {
    const at = engines.findIndex((e) => e.extension);
    engines.splice(at < 0 ? engines.length : at, 0, { id: "custom", name: "Custom", keyword: "custom", url: settings.customSearchUrl, custom: true });
  }
  engineCache.set(custom, { legacyUrl: settings.customSearchUrl, extension, engines });
  return engines;
}

export function controllingSearchExtension(settings: Settings): ExtensionSearchEngine | undefined {
  return controllingExtensionEngine(settings.extensionSearchEngines ?? NO_EXTENSION_ENGINES);
}

export function defaultSearchEngine(settings: Settings): SearchEngine {
  const controlling = controllingSearchExtension(settings);
  return engineById(searchEngines(settings), controlling ? extensionEngineId(controlling.extensionId) : settings.searchEngine);
}

export function searchUrlPrefix(settings: Settings): string {
  return defaultSearchEngine(settings).url;
}

function validateCustomEngine(settings: Settings, input: EngineInput, ignoreId?: string): string | null {
  return validateEngine(input, searchEngines(settings), ignoreId);
}

export function choose(settings: Settings, patch: Partial<Settings>): Settings {
  const chosen = settings.chosen ?? [];
  const added = Object.keys(patch).filter((k) => k !== "chosen" && k !== "inferred" && !chosen.includes(k));
  const inferred = settings.inferred?.filter((k) => !(k in patch));
  return { ...settings, ...patch, ...(added.length ? { chosen: [...chosen, ...added] } : {}), ...(inferred ? { inferred } : {}) };
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
