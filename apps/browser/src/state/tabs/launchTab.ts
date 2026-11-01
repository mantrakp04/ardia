import { switchOn } from "../../platform/killSwitches";
import type { BrowserState } from "../browser/store";
import { tabEngine } from "../engines/engines";
import { engineProfile } from "../browser/model";
import { isRegularWindow, lastActiveSpace } from "../windows/small";
import { wakeOf } from "./pageSession";

export type LaunchTab = { id: string; url: string; profile: string };

export const earlyLaunchTabOn = () => switchOn("launchTab");

const WEB = /^https?:\/\//i;

export function launchTab(s: Pick<BrowserState, "windows" | "tabs" | "settings" | "spaces" | "profiles">, windowId: string | null | undefined): LaunchTab | null {
  const w = windowId ? s.windows[windowId] : undefined;
  if (!isRegularWindow(w) || s.settings.restoreSession === false) return null;
  const t = s.tabs[w.activeTabIds[w.spaceId] ?? ""];
  if (!t || t.windowId !== w.id || t.spaceId !== w.spaceId || !WEB.test(t.url)) return null;
  if (wakeOf(t) || tabEngine(s, t.id) !== "chromium") return null;
  return { id: t.id, url: t.url, profile: engineProfile(s, t.spaceId) };
}

export const linkSpace = (s: Pick<BrowserState, "settings" | "spaces" | "profiles">): string => engineProfile(s, s.settings.defaultSpaceId);
