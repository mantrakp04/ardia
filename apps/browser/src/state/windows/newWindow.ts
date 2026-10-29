import type { BrowserState } from "../browser/store";
import { linkSpaceOf } from "./small";
import type { BrowserWindow, Frame } from "../browser/types";

export function emptyWindow(id: string, spaceId: string, kind: "main" | "private", frame: Frame | null = null): BrowserWindow {
  return { id, spaceId, kind, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame, createdAt: Date.now() };
}

export const smallWindow = (id: string, spaceId: string, frame: Frame | null = null): BrowserWindow => ({
  id,
  spaceId,
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
    ui: { ...s.ui, focusOrder: [w.id, ...s.ui.focusOrder], lastSpaceId: linkSpaceOf(s, w) ?? s.ui.lastSpaceId },
  };
}
