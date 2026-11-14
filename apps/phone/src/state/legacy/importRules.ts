import { acceptsPreference, PREFERENCE_KEYS, type Preferences } from "../settings/preferences.ts";
import type { VisitTransition } from "../store/browserDatabase.ts";
import { TAB_ORIGINS, isSyncableUrl, type BrowserTab, type TabOrigin } from "../tabs/tabModels.ts";

export const LEGACY_IMPORT_KEY = "legacy.importVersion";
export const LEGACY_IMPORT_VERSION = "1";
export const LEGACY_SKIPPED = "skipped-existing";

export type LegacyTabInput = {
  id: string;
  url: string;
  title: string;
  created: number;
  lastActive: number;
  position: number;
  origin: string;
  archivedAt?: number;
  profileSyncId?: string;
  savedState?: string;
  faviconUrl?: string;
  themeColor?: string;
  snapshotPath?: string;
  receivedKey?: string;
  receivedFromDevice?: string;
};

export type LegacyVisitInput = { url: string; title: string; visitedAt: number; transition: string; profileSyncId?: string };

export type LegacyInput = {
  version: number;
  tabs: LegacyTabInput[];
  selectedTabId: string | null;
  archive: LegacyTabInput[];
  visits: LegacyVisitInput[];
  preferences: Record<string, unknown>;
};

export type ImportVisit = { url: string; title: string; visitedAt: number; profileSyncId: string | null; transition: VisitTransition };

export type ImportPlan = {
  tabs: BrowserTab[];
  states: { id: string; data: string }[];
  visits: ImportVisit[];
  preferences: Record<string, string>;
  unmapped: string[];
};

const TRANSITIONS: readonly VisitTransition[] = ["typed", "link", "backForward", "formSubmit", "restored", "other"];

export const importTransition = (raw: string): VisitTransition => ((TRANSITIONS as readonly string[]).includes(raw) ? (raw as VisitTransition) : "other");

const originOf = (raw: string): TabOrigin => ((TAB_ORIGINS as readonly string[]).includes(raw) ? (raw as TabOrigin) : "typed");

const tabUrlKept = (url: string) => isSyncableUrl(url) || url === "about:blank";

export function importTab(tab: LegacyTabInput, archived: boolean): BrowserTab {
  return {
    id: tab.id.toLowerCase(),
    url: tab.url,
    title: tab.title,
    created: tab.created,
    lastActive: tab.lastActive,
    archivedAt: archived ? (tab.archivedAt ?? tab.lastActive) : null,
    position: tab.position,
    profileSyncId: tab.profileSyncId ?? null,
    faviconUrl: tab.faviconUrl && isSyncableUrl(tab.faviconUrl) ? tab.faviconUrl : null,
    themeColorHex: tab.themeColor ?? null,
    snapshotFileName: !archived && tab.snapshotPath ? `file://${tab.snapshotPath}` : null,
    origin: originOf(tab.origin),
    receivedKey: tab.receivedKey ?? null,
    receivedFromDevice: tab.receivedFromDevice ?? null,
    isPrivate: false,
  };
}

const PRIMITIVE = (value: unknown): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

export function importPreferences(stored: Record<string, unknown>): { values: Record<string, string>; unmapped: string[] } {
  const ours = new Map<string, keyof Preferences>(Object.entries(PREFERENCE_KEYS).map(([name, key]) => [key, name as keyof Preferences]));
  const values: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const key of Object.keys(stored).sort()) {
    const value = stored[key];
    const name = ours.get(key);
    if (!name || !PRIMITIVE(value)) {
      unmapped.push(key);
      continue;
    }
    const raw = String(value);
    if (raw === "") continue;
    if (acceptsPreference(name, raw)) values[key] = raw;
    else unmapped.push(key);
  }
  return { values, unmapped };
}

export function importPlan(data: LegacyInput): ImportPlan {
  const seen = new Set<string>();
  const tabs: BrowserTab[] = [];
  const states: { id: string; data: string }[] = [];
  const take = (tab: LegacyTabInput, archived: boolean) => {
    const id = tab.id.toLowerCase();
    if (seen.has(id) || !tabUrlKept(tab.url)) return;
    seen.add(id);
    tabs.push(importTab(tab, archived));
    if (!archived && tab.savedState) states.push({ id, data: tab.savedState });
  };
  for (const tab of data.tabs) take(tab, false);
  for (const tab of data.archive) take(tab, true);
  const visits = data.visits
    .filter((visit) => isSyncableUrl(visit.url))
    .map((visit) => ({ url: visit.url, title: visit.title, visitedAt: visit.visitedAt, profileSyncId: visit.profileSyncId ?? null, transition: importTransition(visit.transition) }))
    .sort((a, b) => a.visitedAt - b.visitedAt);
  const { values, unmapped } = importPreferences(data.preferences);
  return { tabs, states, visits, preferences: values, unmapped };
}

export type ImportState = { available: boolean; marker: string | null; hasData: boolean };

export type ImportStep = "import" | "markExisting" | "done" | "none";

export function importStep(state: ImportState): ImportStep {
  if (state.marker) return "done";
  if (!state.available) return "none";
  return state.hasData ? "markExisting" : "import";
}
