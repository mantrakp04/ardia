import { useBrowser, type BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";

export const store = () => useBrowser.getState();

export type Window = BrowserState["windows"][string];

export const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;

export const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");

export function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => w.profileId === profileId) ?? order[0];
}

export function settleChoices(profileId: string, published: Record<string, number>) {
  const now = store().pinChoices;
  const mine = now[profileId];
  if (!mine) return;
  const left = Object.fromEntries(Object.entries(mine).filter(([key, n]) => published[key] !== n));
  if (Object.keys(left).length === Object.keys(mine).length) return;
  const { [profileId]: _, ...others } = now;
  useBrowser.setState({ pinChoices: Object.keys(left).length ? { ...now, [profileId]: left } : others });
}
