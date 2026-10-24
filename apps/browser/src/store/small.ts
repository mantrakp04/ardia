import type { BrowserState } from "./browser";
import { engineProfile } from "./model";
import type { BrowserWindow } from "./types";

export const isSmallWindow = (w: BrowserWindow | undefined): boolean => w?.kind === "small";

export const isSmall = (s: Pick<BrowserState, "windows">, windowId?: string | null): boolean =>
  !!windowId && s.windows[windowId]?.kind === "small";

const isMain = (w: BrowserWindow | undefined): w is BrowserWindow => !!w && !w.incognito && w.kind !== "small";

export function mainWindowFor(s: BrowserState, profileId?: string): string | undefined {
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isMain(s.windows[id]));
  return (profileId ? order.find((id) => s.windows[id]!.profileId === profileId) : undefined) ?? order[0];
}

export function originalProfile(s: Pick<BrowserState, "profiles">, w: BrowserWindow | undefined): string | undefined {
  const id = w?.incognito ? w.originalProfileId : w?.profileId;
  return id && s.profiles[id] ? id : undefined;
}

export const linkProfileOf = (s: Pick<BrowserState, "profiles">, w: BrowserWindow | undefined): string | undefined =>
  isSmallWindow(w) ? undefined : originalProfile(s, w);

export function privateWindowProfile(s: Pick<BrowserState, "profiles" | "profileOrder">, w: BrowserWindow | undefined, engineName?: string) {
  const named = engineName !== undefined ? s.profileOrder.find((p) => engineProfile(p) === engineName) : undefined;
  return named ?? originalProfile(s, w);
}

export function lastActiveProfile(s: BrowserState): string {
  const last = s.ui.lastProfileId;
  if (last && s.profiles[last]) return last;
  for (const id of [...s.ui.focusOrder, ...[...s.windowOrder].reverse()]) {
    const profile = linkProfileOf(s, s.windows[id]);
    if (profile) return profile;
  }
  return s.settings.defaultProfileId;
}
