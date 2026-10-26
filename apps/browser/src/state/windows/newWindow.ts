import type { BrowserState } from "../browser/store";
import { linkProfileOf } from "./small";
import type { BrowserWindow, Frame } from "../browser/types";

export function emptyWindow(id: string, profileId: string, incognito: boolean, frame: Frame | null = null): BrowserWindow {
  return { id, profileId, incognito, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame, createdAt: Date.now() };
}

export const smallWindow = (id: string, profileId: string, frame: Frame | null = null): BrowserWindow => ({ ...emptyWindow(id, profileId, false, frame), sidebarOpen: false, kind: "small" });

export function withWindow(s: BrowserState, w: BrowserWindow): BrowserState {
  return {
    ...s,
    windows: { ...s.windows, [w.id]: w },
    windowOrder: [...s.windowOrder, w.id],
    ui: { ...s.ui, focusedWindowId: w.id, focusOrder: [w.id, ...s.ui.focusOrder], lastProfileId: linkProfileOf(s, w) ?? s.ui.lastProfileId },
  };
}
