import { requireOptionalNativeModule } from "expo-modules-core";

export type LegacyTab = {
  id: string;
  url: string;
  title: string;
  created: number;
  lastActive: number;
  position: number;
  origin: "typed" | "search" | "link" | "sync" | "share" | "sent";
  archivedAt?: number;
  profileSyncId?: string;
  savedState?: string;
  faviconUrl?: string;
  themeColor?: string;
  snapshotPath?: string;
  receivedKey?: string;
  receivedFromDevice?: string;
};

export type LegacyVisit = {
  url: string;
  title: string;
  visitedAt: number;
  transition: "typed" | "link" | "backForward" | "formSubmit" | "restored" | "other";
  profileSyncId?: string;
};

export type LegacyData = {
  version: 1;
  store: string | null;
  tabs: LegacyTab[];
  selectedTabId: string | null;
  archive: LegacyTab[];
  visits: LegacyVisit[];
  preferences: Record<string, unknown>;
};

type LegacyNative = {
  available(): Promise<boolean>;
  imported?(): Promise<boolean>;
  markImported?(): Promise<void>;
  read(): Promise<(Omit<LegacyData, "store" | "selectedTabId"> & { store?: string; selectedTabId?: string }) | null>;
};

const native = requireOptionalNativeModule<LegacyNative>("ArdiaLegacy");

export const legacy = {
  available: async (): Promise<boolean> => (native ? native.available() : false),
  imported: async (): Promise<boolean> => (native?.imported ? native.imported() : true),
  markImported: async (): Promise<void> => {
    await native?.markImported?.();
  },
  read: async (): Promise<LegacyData | null> => {
    const data = native ? await native.read() : null;
    return data ? { ...data, store: data.store ?? null, selectedTabId: data.selectedTabId ?? null } : null;
  },
};
