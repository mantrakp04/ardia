import { Cef } from "./native";

export type FilterListCategory = "ads" | "trackers" | "cookies" | "regional" | "annoyances" | "security";

export type FilterList = {
  id: string;
  title: string;
  category: FilterListCategory;
  enabled: boolean;
  defaultOn: boolean;
  filters: number;
};

export type ContentBlockerStats = {
  ready: boolean;
  enabled: boolean;
  networkFilters?: number;
  cosmeticFilters?: number;
  unsupportedFilters?: number;
  parseMs: number;
  lookups: number;
  averageLookupMicros: number;
  maxLookupMicros: number;
  error?: string;
};

export type ContentBlockerProvider = "ublock" | "adnauseam";

export type ContentBlockerState = {
  provider: ContentBlockerProvider;
  selectedProvider: ContentBlockerProvider;
  availableProviders: ContentBlockerProvider[];
  clickAds: boolean;
  enabled: boolean;
  version: string;
  lists: FilterList[];
  allowedHosts: string[];
  stats: ContentBlockerStats;
};

export const getContentBlocker = () => Cef.getContentBlocker();
export const setContentBlockerEnabled = (enabled: boolean) => Cef.setContentBlockerEnabled(enabled);
export const setFilterListEnabled = (id: string, enabled: boolean) => Cef.setFilterListEnabled(id, enabled);
export const isContentBlockerAllowed = (host: string) => Cef.isContentBlockerAllowed(host);
export const setContentBlockerAllowed = (host: string, allowed: boolean) => Cef.setContentBlockerAllowed(host, allowed);
export const setContentBlockerProvider = (provider: ContentBlockerProvider, clickConsent: boolean) => Cef.setContentBlockerProvider(provider, clickConsent);
export const onContentBlockerChange = (listener: (stats: ContentBlockerStats) => void) =>
  Cef.addListener("onContentBlocker", listener);

export type PrivacySettings = {
  activity: { collected: number; clicked: number } | null;
  clicking: boolean;
  ready: boolean;
  globalPrivacyControl: boolean;
  managed: boolean;
  cleanLinks: boolean;
  cname: boolean;
  cnameAvailable: boolean;
  cleanExceptions: string[];
  cnameExceptions: string[];
  forgetSites: string[];
  forgetErrors: Record<string, string>;
  pendingForget: string[];
  site: string;
  cleanExcepted: boolean;
  cnameExcepted: boolean;
  forget: boolean;
  mode: ContentBlockerProvider;
  blocking: boolean;
};
export type PrivacySettingKey = "globalPrivacyControl" | "cleanLinks" | "cname" | "cleanExceptions" | "cnameExceptions" | "forgetSites";
export const getPrivacySettings = (profile: string, origin = ""): Promise<PrivacySettings> => Cef.getPrivacySettings(profile, origin);
export const setPrivacySetting = (profile: string, key: PrivacySettingKey, value: boolean, origin = "") => Cef.setPrivacySetting(profile, key, value, origin);
