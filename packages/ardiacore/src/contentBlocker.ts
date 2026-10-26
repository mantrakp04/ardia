import { call, on } from "./engine/call";

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
};

export type ContentBlockerState = {
  enabled: boolean;
  version: string;
  lists: FilterList[];
  allowedHosts: string[];
  stats: ContentBlockerStats;
};

export const getContentBlocker = () => call("contentBlocker.state");
export const setContentBlockerEnabled = (enabled: boolean) => call("contentBlocker.setEnabled", { enabled });
export const setFilterListEnabled = (id: string, enabled: boolean) => call("contentBlocker.setListEnabled", { id, enabled });
export const isContentBlockerAllowed = (host: string) => call("contentBlocker.isAllowed", { host });
export const setContentBlockerAllowed = (host: string, allowed: boolean) => call("contentBlocker.setAllowed", { host, allowed });
export const onContentBlockerChange = (listener: (stats: ContentBlockerStats) => void) => on("contentBlocker.changed", listener);
