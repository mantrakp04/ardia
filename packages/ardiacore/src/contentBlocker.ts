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

export type CustomFilterList = {
  id: string;
  title: string;
  enabled: boolean;
  filters: number;
  downloaded: boolean;
  updatedAt: number;
  error: string;
};

export type AddedFilterList = { id: string; title: string; builtIn: boolean; filters: number };

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
};

export type ContentBlockerState = {
  enabled: boolean;
  version: string;
  lists: FilterList[];
  customLists?: CustomFilterList[];
  userFilters?: number;
  updating?: boolean;
  allowedHosts: string[];
  stats: ContentBlockerStats;
};

export const getContentBlocker = () => Cef.getContentBlocker();
export const setContentBlockerEnabled = (enabled: boolean) => Cef.setContentBlockerEnabled(enabled);
export const setFilterListEnabled = (id: string, enabled: boolean) => Cef.setFilterListEnabled(id, enabled);
export const addFilterList = (url: string) => Cef.addFilterList(url);
export const removeFilterList = (id: string) => Cef.removeFilterList(id);
export const updateFilterList = (id: string) => Cef.updateFilterList(id);
export const getUserFilters = () => Cef.getUserFilters();
export const setUserFilters = (text: string) => Cef.setUserFilters(text);
export const isContentBlockerAllowed = (host: string) => Cef.isContentBlockerAllowed(host);
export const setContentBlockerAllowed = (host: string, allowed: boolean) => Cef.setContentBlockerAllowed(host, allowed);
export const onContentBlockerChange = (listener: (stats: ContentBlockerStats) => void) =>
  Cef.addListener("onContentBlocker", listener);
