import type { HLC } from "../../platform/sync";
import { useBrowser, type BrowserState } from "../browser/store";
import type { MainWindow, Tab } from "../browser/types";
import { fromSync } from "../pins/pinOrderChoices";
import { PIN_TAB } from "./pinRecords";
import { isRegularWindow } from "../windows/small";

export const store = () => useBrowser.getState();

export type Window = MainWindow;



export const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter(isRegularWindow);

export const windowsHomeFirst = (s: BrowserState, home: Window | undefined) => (home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s));

export const unpinnedRemotely = (recorded: (key: string) => boolean, remote: (key: string) => unknown) => (key: string) =>
  recorded(`${PIN_TAB}${key}`) && remote(`${PIN_TAB}${key}`) === null;

type Parked = BrowserState["parkedPins"][string];

export function commitPinnedEdit(s: BrowserState, profileId: string, patch: Partial<BrowserState>, parked: Partial<Parked> | null) {
  fromSync(() => useBrowser.setState({ ...patch, ...(parked ? { parkedPins: { ...s.parkedPins, [profileId]: { ...s.parkedPins[profileId]!, ...parked } } } : {}) }));
}

export function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter(isRegularWindow);
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => w.profileId === profileId) ?? order[0];
}

export const choiceStillOut = (chosen: Record<string, HLC>, choice: string, stamp: HLC | undefined) =>
  choice in chosen && (stamp === undefined || stamp < chosen[choice]!);

export function settleChoices(profileId: string, published: Record<string, HLC>) {
  const now = store().pinChoices;
  const mine = now[profileId];
  if (!mine) return;
  const left = Object.fromEntries(Object.entries(mine).filter(([key, n]) => published[key] !== n));
  if (Object.keys(left).length === Object.keys(mine).length) return;
  const { [profileId]: _, ...others } = now;
  useBrowser.setState({ pinChoices: Object.keys(left).length ? { ...now, [profileId]: left } : others });
}
