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
