import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { isIncognitoSpace, without } from "../browser/model";
import { hostOf } from "@ardia/core";

export type MuteState = "site" | "tab" | null;

type SiteMutes = Pick<BrowserState, "settings" | "privateSiteMutes">;
type MutedTab = Pick<Tab, "url" | "windowId" | "spaceId" | "muted">;

export function isHostMuted(s: SiteMutes, tab: Pick<Tab, "windowId" | "spaceId">, host: string): boolean {
  const own = isIncognitoSpace(tab.spaceId) ? s.privateSiteMutes[tab.windowId]?.[host] : undefined;
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
  const anyMuted = (s.settings.mutedSites?.length ?? 0) > 0 || (isIncognitoSpace(tab.spaceId) && !!s.privateSiteMutes[tab.windowId]);
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
    if (isIncognitoSpace(tab.spaceId)) {
      const own = { ...s.privateSiteMutes[tab.windowId], [host]: muted };
      return set({ privateSiteMutes: { ...get().privateSiteMutes, [tab.windowId]: own } });
    }
    const sites = new Set(s.settings.mutedSites);
    if (muted) sites.add(host);
    else sites.delete(host);
    get().updateSettings({ mutedSites: [...sites] });
  },
});
export { sessionWithOwnTabMutes } from "../../lib/sessionMuteUpgrade";
