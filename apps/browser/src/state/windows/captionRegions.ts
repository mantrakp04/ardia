import { create } from "zustand";
import { windowControls, type CaptionRegion } from "../../platform/windowControls";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser, type BrowserState } from "../browser/store";
import { useOnboarding } from "../onboarding/onboarding";
import { captionRegions } from "./layout";
import { WINDOW_CHROME } from "../../lib/windowChrome";

const sent = new Map<string, string>();

export function syncCaptionRegions(s: BrowserState, onboardingWindow: string | null, send: (windowId: string, regions: CaptionRegion[]) => void = windowControls.setCaptionRegions) {
  for (const id of Object.keys(s.windows)) {
    const regions = captionRegions(s, id, id === onboardingWindow);
    const key = JSON.stringify(regions);
    if ((sent.get(id) ?? "[]") === key) continue;
    sent.set(id, key);
    send(id, regions);
  }
  for (const id of [...sent.keys()]) if (!s.windows[id]) sent.delete(id);
}

export const useMaximizedWindows = create<Record<string, true>>()(() => ({}));

export const useWindowMaximized = (windowId: string): boolean => useMaximizedWindows((m) => !!m[windowId]);

function noteMaximized(windowId: string, on: boolean) {
  useMaximizedWindows.setState((m) => {
    if (!!m[windowId] === on) return m;
    const { [windowId]: _, ...rest } = m;
    return on ? { ...m, [windowId]: true } : rest;
  }, true);
}

export function startCaptionRegionSync() {
  if (!WINDOW_CHROME.trailingWidth) return;
  const sync = () => syncCaptionRegions(useBrowser.getState(), useOnboarding.getState().windowId);
  sync();
  useBrowser.subscribe(sync);
  useOnboarding.subscribe(sync);
  onWindowEvent((e) => {
    if (e.type === "maximized") noteMaximized(e.id, e.on);
    if (e.type === "close") noteMaximized(e.id, false);
  });
}
