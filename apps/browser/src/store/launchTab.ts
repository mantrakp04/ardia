import { switchOn } from "../lib/killSwitches";
import type { BrowserState } from "./browser";
import { tabEngine } from "./engines";
import { engineProfile } from "./model";
import { lastActiveProfile } from "./small";

export type LaunchTab = { id: string; url: string; profile: string };

export const earlyLaunchTabOn = () => switchOn("launchTab");

const WEB = /^https?:\/\//i;

export function launchTab(s: Pick<BrowserState, "windows" | "tabs" | "settings">, windowId: string | null | undefined): LaunchTab | null {
  const w = windowId ? s.windows[windowId] : undefined;
  if (!w || w.incognito || w.kind === "small" || s.settings.restoreSession === false) return null;
  const t = s.tabs[w.activeTabIds[w.profileId] ?? ""];
  if (!t || t.windowId !== w.id || t.profileId !== w.profileId || !WEB.test(t.url)) return null;
  if (t.wakeAdoptId || tabEngine(s, t.id) !== "chromium") return null;
  return { id: t.id, url: t.url, profile: engineProfile(t.profileId) };
}

export const linkProfile = (s: BrowserState): string => engineProfile(lastActiveProfile(s));
