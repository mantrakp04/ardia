import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { linkProfileOf } from "./small";
import type { FindState, NewTabTarget, WindowUi } from "../browser/types";
import { commandBarFocus, expectFocus } from "../focus/focusClaims";

export const focusedWindowOf = (s: Pick<BrowserState, "ui">): string | null => s.ui.focusOrder[0] ?? null;

export type UiSlice = {
  ui: {
    focusOrder: string[];
    appDark: boolean;
    lastProfileId: string | null;
  };
  windowUi: Record<string, WindowUi>;
  find: Record<string, FindState>;

  setFocusedWindow(id: string): void;
  setAppDark(dark: boolean): void;
  openPanel(windowId: string, initialText?: string, newTab?: NewTabTarget): void;
  closePanel(windowId: string): void;
  setDownloadsOpen(windowId: string, open: boolean): void;
  setFind(tabId: string, patch: Partial<FindState>): void;
};

export const DEFAULT_WINDOW_UI: WindowUi = { panel: { open: false, initialText: "" }, downloadsOpen: false };
export const CLOSED_FIND: FindState = { open: false, query: "", count: null, active: 0 };
export function patchWindowUi(s: BrowserState, windowId: string, patch: Partial<WindowUi>): Partial<BrowserState> {
  if (!s.windows[windowId]) return {};
  return { windowUi: { ...s.windowUi, [windowId]: { ...(s.windowUi[windowId] ?? DEFAULT_WINDOW_UI), ...patch } } };
}

export const createUiSlice: StateCreator<BrowserState, [], [], UiSlice> = (set, get) => ({
  ui: { focusOrder: [], appDark: true, lastProfileId: null },
  windowUi: {},
  find: {},

  setFocusedWindow(id) {
    const s = get();
    const { ui, windows } = s;
    if (!windows[id]) return;
    const lastProfileId = linkProfileOf(s, windows[id]) ?? ui.lastProfileId;
    if (ui.focusOrder[0] === id && ui.lastProfileId === lastProfileId) return;
    set({ ui: { ...ui, focusOrder: [id, ...ui.focusOrder.filter((w) => w !== id)], lastProfileId } });
  },

  setAppDark(appDark) {
    if (get().ui.appDark !== appDark) set((s) => ({ ui: { ...s.ui, appDark } }));
  },

  openPanel(windowId, initialText = "", newTab) {
    expectFocus(windowId, commandBarFocus);
    set((s) => patchWindowUi(s, windowId, { panel: newTab ? { open: true, initialText, newTab } : { open: true, initialText } }));
  },

  closePanel(windowId) {
    set((s) => patchWindowUi(s, windowId, { panel: { open: false, initialText: "" } }));
  },

  setDownloadsOpen(windowId, downloadsOpen) {
    set((s) => patchWindowUi(s, windowId, { downloadsOpen }));
  },

  setFind(tabId, patch) {
    set((s) => (s.tabs[tabId] ? { find: { ...s.find, [tabId]: { ...(s.find[tabId] ?? CLOSED_FIND), ...patch } } } : {}));
  },
});
