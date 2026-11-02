import type { BrowserState } from "../browser/store";
import { linkProfileOf } from "./small";
import type { BrowserWindow, Frame } from "../browser/types";

export function emptyWindow(id: string, profileId: string, kind: "main" | "private", frame: Frame | null = null): BrowserWindow {
  return { id, profileId, kind, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame, createdAt: Date.now() };
}

export const smallWindow = (id: string, profileId: string, frame: Frame | null = null): BrowserWindow => ({
  id,
  profileId,
  kind: "small",
  tabIds: [],
  activeTabIds: {},
  sidebarOpen: false,
  frame,
  createdAt: Date.now(),
});

export function withWindow(s: BrowserState, w: BrowserWindow): BrowserState {
  return {
    ...s,
    windows: { ...s.windows, [w.id]: w },
    windowOrder: [...s.windowOrder, w.id],
    ui: { ...s.ui, focusOrder: [w.id, ...s.ui.focusOrder], lastProfileId: linkProfileOf(s, w) ?? s.ui.lastProfileId },
  };
}
