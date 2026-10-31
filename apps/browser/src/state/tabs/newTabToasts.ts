import { create } from "zustand";
import type { BrowserWindow, Tab } from "../browser/types";
import { isAsleep } from "./pageSession";

export const NEW_TAB_TOAST_LIFETIME = 5000;
export const NEW_TAB_TOAST_FADE = 180;
export const NEW_TAB_TOAST_HEIGHT = 40;
export const NEW_TAB_TOAST_GAP = 8;
export const NEW_TAB_TOAST_WIDTH = 164;

export type NewTabToast = {
  tabId: string;
  windowId: string;
  profileId: string;
  appearedAt: number | null;
  leaving: boolean;
};

type ToastState = { items: NewTabToast[] };
type Owner = Pick<Tab, "id" | "windowId" | "profileId" | "page">;
type Browser = { tabs: Record<string, Tab>; windows: Record<string, BrowserWindow>; activate(id: string): void };
type Timing = { now(): number; set(run: () => void, ms: number): ReturnType<typeof setTimeout>; clear(timer: ReturnType<typeof setTimeout>): void };

export function newTabToastCapacity(height: number): number {
  return Math.max(0, Math.floor((height - 20 + NEW_TAB_TOAST_GAP) / (NEW_TAB_TOAST_HEIGHT + NEW_TAB_TOAST_GAP)));
}

export function visibleNewTabToasts(items: NewTabToast[], windowId: string, profileId: string | undefined, height: number, obscured = false, width = Infinity): NewTabToast[] {
  return obscured || width < NEW_TAB_TOAST_WIDTH + 34 ? [] : items.filter((t) => t.windowId === windowId && t.profileId === profileId).slice(0, newTabToastCapacity(height));
}

export function createNewTabToasts(timing: Timing = { now: () => Date.now(), set: (run, ms) => globalThis.setTimeout(run, ms), clear: (timer) => globalThis.clearTimeout(timer) }) {
  const useStore = create<ToastState>()(() => ({ items: [] }));
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const remove = (tabId: string) => {
    const timer = timers.get(tabId);
    if (timer !== undefined) timing.clear(timer);
    timers.delete(tabId);
    useStore.setState((s) => ({ items: s.items.filter((t) => t.tabId !== tabId) }));
  };
  const add = (tab: Owner | undefined) => {
    if (!tab || isAsleep(tab) || useStore.getState().items.some((t) => t.tabId === tab.id)) return;
    useStore.setState((s) => ({ items: [...s.items, { tabId: tab.id, windowId: tab.windowId, profileId: tab.profileId, appearedAt: null, leaving: false }] }));
  };
  const present = (tabId: string) => {
    const toast = useStore.getState().items.find((t) => t.tabId === tabId);
    if (!toast || toast.appearedAt !== null) return;
    timers.set(tabId, timing.set(() => {
      if (!useStore.getState().items.some((t) => t.tabId === tabId)) return;
      timers.set(tabId, timing.set(() => remove(tabId), NEW_TAB_TOAST_FADE));
      useStore.setState((s) => ({ items: s.items.map((t) => t.tabId === tabId ? { ...t, leaving: true } : t) }));
    }, NEW_TAB_TOAST_LIFETIME - NEW_TAB_TOAST_FADE));
    useStore.setState((s) => ({ items: s.items.map((t) => t.tabId === tabId ? { ...t, appearedAt: timing.now() } : t) }));
  };
  const clear = () => {
    for (const timer of timers.values()) timing.clear(timer);
    timers.clear();
    useStore.setState({ items: [] });
  };
  const prune = (s: Pick<Browser, "tabs" | "windows">) => {
    for (const toast of useStore.getState().items) {
      const tab = s.tabs[toast.tabId];
      if (!tab || isAsleep(tab) || tab.windowId !== toast.windowId || tab.profileId !== toast.profileId || !s.windows[toast.windowId]) remove(toast.tabId);
    }
  };
  const activate = (tabId: string, windowId: string, profileId: string, s: Browser) => {
    const toast = useStore.getState().items.find((t) => t.tabId === tabId);
    const tab = s.tabs[tabId];
    if (!toast || toast.windowId !== windowId || toast.profileId !== profileId) return;
    remove(tabId);
    if (tab && !isAsleep(tab) && tab.windowId === windowId && tab.profileId === profileId && s.windows[windowId]?.profileId === profileId) s.activate(tabId);
  };
  return { useStore, add, present, remove, clear, prune, activate };
}

export const newTabToasts = createNewTabToasts();
