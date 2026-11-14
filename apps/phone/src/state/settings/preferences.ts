import { isAutoArchiveInterval, STANDARD_AUTO_ARCHIVE, type AutoArchiveInterval } from "../tabs/tabModels.ts";

export type NightShadeMode = "disabled" | "automatic" | "always";
export type SwipeNavigationMode = "anywhere" | "screenEdges" | "disabled";
export type AppLinkPreference = "ardia" | "app";
export type ColorChoice = "plum" | "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "neutral";

export type Preferences = {
  autoArchiveInterval: AutoArchiveInterval;
  nightShade: NightShadeMode;
  swipeNavigation: SwipeNavigationMode;
  appLinks: AppLinkPreference;
  searchSuggestions: boolean;
  searchEngineId: string;
  collapsesBottomBar: boolean;
  autoOpensKeyboard: boolean;
  hasFinishedOnboarding: boolean;
  archiveCardShown: boolean;
  colorChoice: ColorChoice | null;
  readerStep: number;
  readerSerif: boolean;
  readerTheme: "light" | "sepia" | "dark" | null;
  appearance: "system" | "light" | "dark";
};

export const DEFAULT_PREFERENCES: Preferences = {
  autoArchiveInterval: STANDARD_AUTO_ARCHIVE,
  nightShade: "disabled",
  swipeNavigation: "anywhere",
  appLinks: "ardia",
  searchSuggestions: true,
  searchEngineId: "google",
  collapsesBottomBar: false,
  autoOpensKeyboard: true,
  hasFinishedOnboarding: false,
  archiveCardShown: false,
  colorChoice: null,
  readerStep: 2,
  readerSerif: true,
  readerTheme: null,
  appearance: "system",
};

export const PREFERENCE_KEYS: Record<keyof Preferences, string> = {
  autoArchiveInterval: "tabs.autoArchiveInterval",
  nightShade: "browsing.nightShade",
  swipeNavigation: "browsing.swipeNavigation",
  appLinks: "browsing.appLinks",
  searchSuggestions: "browsing.searchSuggestions",
  searchEngineId: "browsing.searchEngine",
  collapsesBottomBar: "settings.collapseBottomBar",
  autoOpensKeyboard: "settings.autoOpenKeyboard",
  hasFinishedOnboarding: "settings.finishedOnboarding",
  archiveCardShown: "tabs.archiveCardShown",
  colorChoice: "settings.color",
  readerStep: "reader.sizeStep",
  readerSerif: "reader.serif",
  readerTheme: "reader.theme",
  appearance: "settings.appearance",
};

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (raw: string): T | undefined =>
    (values as readonly string[]).includes(raw) ? (raw as T) : undefined;

const flag = (raw: string) => (raw === "true" ? true : raw === "false" ? false : undefined);

const PARSERS: { [K in keyof Preferences]: (raw: string) => Preferences[K] | undefined } = {
  autoArchiveInterval: (raw) => (isAutoArchiveInterval(raw) ? raw : undefined),
  nightShade: oneOf<NightShadeMode>(["disabled", "automatic", "always"]),
  swipeNavigation: oneOf<SwipeNavigationMode>(["anywhere", "screenEdges", "disabled"]),
  appLinks: oneOf<AppLinkPreference>(["ardia", "app"]),
  searchSuggestions: flag,
  searchEngineId: (raw) => raw || undefined,
  collapsesBottomBar: flag,
  autoOpensKeyboard: flag,
  hasFinishedOnboarding: flag,
  archiveCardShown: flag,
  colorChoice: oneOf<ColorChoice>(["plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral"]),
  readerStep: (raw) => (/^\d$/.test(raw) && Number(raw) <= 6 ? Number(raw) : undefined),
  readerSerif: flag,
  readerTheme: oneOf<"light" | "sepia" | "dark">(["light", "sepia", "dark"]),
  appearance: oneOf<"system" | "light" | "dark">(["system", "light", "dark"]),
};

export function parsePreferences(stored: Record<string, string>): Preferences {
  const out = { ...DEFAULT_PREFERENCES } as Record<keyof Preferences, unknown>;
  for (const name of Object.keys(PREFERENCE_KEYS) as (keyof Preferences)[]) {
    const raw = stored[PREFERENCE_KEYS[name]];
    if (raw === undefined) continue;
    const value = PARSERS[name](raw);
    if (value !== undefined) out[name] = value;
  }
  return out as Preferences;
}

export const serializePreference = <K extends keyof Preferences>(value: Preferences[K]): string | null =>
  value === null ? null : String(value);
