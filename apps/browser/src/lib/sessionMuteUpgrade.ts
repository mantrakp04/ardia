import { hostOf } from "@ardia/core";

type SavedDoc = Record<string, unknown>;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function sessionWithOwnTabMutes(doc: SavedDoc): SavedDoc {
  const settings = doc.settings as { mutedSites?: unknown } | undefined;
  const sites = new Set(listOf(settings?.mutedSites).filter((h): h is string => typeof h === "string"));
  if (!sites.size) return doc;
  const own = <T>(t: T): T => {
    const tab = t as { muted?: boolean; url?: string; profileId?: string; spaceId?: string } | null;
    if (!tab?.muted || typeof tab.url !== "string" || (tab.spaceId ?? tab.profileId ?? "").startsWith("incognito:")) return t;
    const host = hostOf(tab.url);
    return host && sites.has(host) ? ({ ...tab, muted: false } as T) : t;
  };
  const withTab = (entry: unknown) => (entry && typeof entry === "object" && "tab" in entry ? { ...entry, tab: own((entry as { tab: unknown }).tab) } : entry);
  const withTabs = (entry: unknown) => (entry && typeof entry === "object" && "tabs" in entry ? { ...entry, tabs: listOf((entry as { tabs: unknown }).tabs).map(own) } : entry);
  const parked = doc.parkedPins && typeof doc.parkedPins === "object" ? Object.fromEntries(Object.entries(doc.parkedPins).map(([id, p]) => [id, withTabs(p)])) : doc.parkedPins;
  const parkedApps = doc.parkedTopApps && typeof doc.parkedTopApps === "object" ? Object.fromEntries(Object.entries(doc.parkedTopApps).map(([id, tabs]) => [id, listOf(tabs).map(own)])) : doc.parkedTopApps;
  return {
    ...doc,
    tabs: listOf(doc.tabs).map(own),
    closedTabs: listOf(doc.closedTabs).map(withTab),
    cleanedTabs: listOf(doc.cleanedTabs).map(withTab),
    closedWindows: listOf(doc.closedWindows).map(withTabs),
    closedGroups: listOf(doc.closedGroups).map(withTabs),
    deletedGroups: listOf(doc.deletedGroups).map(withTabs),
    parkedPins: parked,
    parkedTopApps: parkedApps,
  };
}
