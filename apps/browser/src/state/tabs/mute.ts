import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { isIncognitoProfile, without } from "../browser/model";
import { hostOf } from "@ardia/core";
import { isString, listOf } from "../../lib/decode";

export type MuteState = "site" | "tab" | null;

type SiteMutes = Pick<BrowserState, "settings" | "privateSiteMutes">;
type MutedTab = Pick<Tab, "url" | "windowId" | "profileId" | "muted">;

export function isHostMuted(s: SiteMutes, tab: Pick<Tab, "windowId" | "profileId">, host: string): boolean {
  const own = isIncognitoProfile(tab.profileId) ? s.privateSiteMutes[tab.windowId]?.[host] : undefined;
  return own ?? s.settings.mutedSites.includes(host);
}

const HOST_CACHE_LIMIT = 512;
const hosts = new Map<string, string>();

function cachedHost(url: string): string {
  let host = hosts.get(url);
  if (host === undefined) {
    if (hosts.size >= HOST_CACHE_LIMIT) hosts.clear();
    host = hostOf(url);
    hosts.set(url, host);
  }
  return host;
}

export function isSiteMuted(s: SiteMutes, tab: Omit<MutedTab, "muted">): boolean {
  const anyMuted = (s.settings.mutedSites?.length ?? 0) > 0 || (isIncognitoProfile(tab.profileId) && !!s.privateSiteMutes[tab.windowId]);
  if (!anyMuted || !tab.url) return false;
  const host = cachedHost(tab.url);
  return !!host && isHostMuted(s, tab, host);
}

export const muteState = (s: SiteMutes, tab: MutedTab): MuteState => (isSiteMuted(s, tab) ? "site" : tab.muted ? "tab" : null);

export const isSilenced = (s: SiteMutes, tab: MutedTab): boolean => tab.muted || isSiteMuted(s, tab);

export function muteTitle(state: MuteState): string {
  if (state === "site") return "Unmute Site";
  return state === "tab" ? "Unmute Tab" : "Mute Tab";
}

export const siteMuteTitle = (state: MuteState): string => (state === "site" ? "Unmute Site" : "Mute Site");

export const muteSymbol = (state: MuteState): string => (state ? "speaker.wave.2" : "speaker.slash");

type SavedDoc = Record<string, unknown>;

export function sessionWithOwnTabMutes(doc: SavedDoc): SavedDoc {
  const settings = doc.settings as { mutedSites?: unknown } | undefined;
  const sites = new Set(listOf(settings?.mutedSites).filter(isString));
  if (!sites.size) return doc;
  const own = <T>(t: T): T => {
    const tab = t as Partial<Tab> | null;
    if (!tab?.muted || typeof tab.url !== "string" || isIncognitoProfile(tab.profileId ?? "")) return t;
    const host = hostOf(tab.url);
    return host && sites.has(host) ? ({ ...tab, muted: false } as T) : t;
  };
  const withTab = (entry: unknown) => (entry && typeof entry === "object" && "tab" in entry ? { ...entry, tab: own((entry as { tab: unknown }).tab) } : entry);
  const withTabs = (entry: unknown) => (entry && typeof entry === "object" && "tabs" in entry ? { ...entry, tabs: listOf((entry as { tabs: unknown }).tabs).map(own) } : entry);
  const parked = doc.parkedPins && typeof doc.parkedPins === "object" ? Object.fromEntries(Object.entries(doc.parkedPins).map(([id, p]) => [id, withTabs(p)])) : doc.parkedPins;
  return {
    ...doc,
    tabs: listOf(doc.tabs).map(own),
    closedTabs: listOf(doc.closedTabs).map(withTab),
    cleanedTabs: listOf(doc.cleanedTabs).map(withTab),
    closedWindows: listOf(doc.closedWindows).map(withTabs),
    closedGroups: listOf(doc.closedGroups).map(withTabs),
    deletedGroups: listOf(doc.deletedGroups).map(withTabs),
    parkedPins: parked,
  };
}


export type MuteSlice = {
  privateSiteMutes: Record<string, Record<string, boolean>>;

  setMuted(ids: string[], muted: boolean): void;
  setSiteMuted(tabId: string, muted: boolean): void;
};

export function forgetClosedWindowMutes(s: BrowserState, prev: BrowserState): Pick<BrowserState, "privateSiteMutes"> | null {
  if (s.windows === prev.windows) return null;
  const gone = Object.keys(s.privateSiteMutes).filter((id) => !s.windows[id]);
  return gone.length ? { privateSiteMutes: without(s.privateSiteMutes, gone) } : null;
}

export const createMuteSlice: StateCreator<BrowserState, [], [], MuteSlice> = (set, get) => ({
  privateSiteMutes: {},

  setMuted(ids, muted) {
    set((s) => {
      const tabs = { ...s.tabs };
      let changed = false;
      for (const id of ids) {
        const t = tabs[id];
        if (t && t.muted !== muted) {
          tabs[id] = { ...t, muted };
          changed = true;
        }
      }
      return changed ? { tabs } : {};
    });
  },

  setSiteMuted(tabId, muted) {
    const s = get();
    const tab = s.tabs[tabId];
    if (!tab) return;
    const host = hostOf(tab.url);
    if (!host) return;
    if (isIncognitoProfile(tab.profileId)) {
      const own = { ...s.privateSiteMutes[tab.windowId], [host]: muted };
      return set({ privateSiteMutes: { ...get().privateSiteMutes, [tab.windowId]: own } });
    }
    const sites = new Set(s.settings.mutedSites);
    if (muted) sites.add(host);
    else sites.delete(host);
    get().updateSettings({ mutedSites: [...sites] });
  },
});
