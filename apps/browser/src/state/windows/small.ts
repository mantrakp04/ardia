import type { BrowserState } from "../browser/store";
import { isWindowClosing } from "./closingWindows";
import { engineProfile, incognitoOriginal } from "../browser/model";
import type { BrowserWindow, MainWindow } from "../browser/types";

export const SMALL_BAR_HEIGHT = 38;
export const SMALL_LIGHTS_CENTER: [number, number] = [20, SMALL_BAR_HEIGHT / 2];

export const isSmallWindow = (w: BrowserWindow | undefined): boolean => w?.kind === "small";

export const isRegularWindow = (w: BrowserWindow | undefined): w is MainWindow => w?.kind === "main";

export const isSmall = (s: Pick<BrowserState, "windows">, windowId?: string | null): boolean =>
  !!windowId && s.windows[windowId]?.kind === "small";

const isMain = (w: BrowserWindow | undefined): w is BrowserWindow => isRegularWindow(w) && !isWindowClosing(w.id);

export function mainWindowFor(s: BrowserState, profileId?: string): string | undefined {
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isMain(s.windows[id]));
  return (profileId ? order.find((id) => s.windows[id]!.profileId === profileId) : undefined) ?? order[0];
}

export function originalProfile(s: Pick<BrowserState, "profiles">, w: BrowserWindow | undefined): string | undefined {
  const id = w?.kind === "private" ? incognitoOriginal(w.profileId) : w?.profileId;
  return id && s.profiles[id] ? id : undefined;
}

export const linkProfileOf = (s: Pick<BrowserState, "profiles">, w: BrowserWindow | undefined): string | undefined =>
  isSmallWindow(w) ? undefined : originalProfile(s, w);

export function privateWindowProfile(s: Pick<BrowserState, "profiles" | "profileOrder">, w: BrowserWindow | undefined, engineName?: string) {
  const named = engineName !== undefined ? s.profileOrder.find((p) => engineProfile(s, p) === engineName) : undefined;
  return named ?? originalProfile(s, w);
}

export const newWindowProfile = (s: BrowserState, windowId?: string | null): string =>
  originalProfile(s, windowId ? s.windows[windowId] : undefined) ?? lastActiveProfile(s);

export function lastActiveProfile(s: Pick<BrowserState, "profiles" | "windows" | "windowOrder" | "ui" | "settings">): string {
  const last = s.ui.lastProfileId;
  if (last && s.profiles[last]) return last;
  for (const id of [...s.ui.focusOrder, ...[...s.windowOrder].reverse()]) {
    const profile = linkProfileOf(s, s.windows[id]);
    if (profile) return profile;
  }
  return s.settings.defaultProfileId;
}
