import type { ArdiaHost } from "./host";
import { reportHostError } from "./host.ts";
import type { AdoptId, BrowserWindow } from "../../browser/src/state/browser/types";
import type { NewTabOptions } from "../../browser/src/state/tabs/tabs";
import { asAdoptId } from "../../browser/src/state/tabs/adoptIds";

export type UnclaimedTab = { adoptId: string; url: string; active: boolean };

type TabStore = {
  getState(): { windows: Record<string, BrowserWindow | undefined>; newTab(windowId: string, options?: NewTabOptions): string };
};

export function unclaimedAdoptId(offer: unknown): AdoptId | undefined {
  if (!offer || typeof offer !== "object") return undefined;
  const { adoptId, url } = offer as Partial<UnclaimedTab>;
  return typeof url === "string" && typeof adoptId === "string" && /^tab:\d+$/.test(adoptId) ? asAdoptId(adoptId) : undefined;
}

export function adoptUnclaimedTab(store: TabStore, windowId: string, offer: unknown) {
  const adoptId = unclaimedAdoptId(offer);
  const s = store.getState();
  const w = s.windows[windowId];
  if (!adoptId || !w) return undefined;
  const { url, active } = offer as UnclaimedTab;
  return s.newTab(windowId, { url: url || undefined, adoptId, profileId: w.profileId, background: active !== true || w.kind === "small" });
}

export function watchUnclaimedTabs(host: ArdiaHost, store: TabStore, windowId = host.bootstrap.windowId) {
  const stop = host.onEvent((module, event, payload) => {
    if (module === "ArdiaTabs" && event === "unclaimed") adoptUnclaimedTab(store, windowId, payload);
  });
  void Promise.resolve(host.invoke("ArdiaTabs.unclaimedTabs", { args: [] })).then((tabs) => {
    if (Array.isArray(tabs)) for (const offer of tabs) adoptUnclaimedTab(store, windowId, offer);
  }).catch(reportHostError);
  return stop;
}
