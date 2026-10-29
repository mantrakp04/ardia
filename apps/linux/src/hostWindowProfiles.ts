import type { WindowEvent } from "@ardia-real/shell";
import type { BrowserState, HydrateData } from "../../browser/src/state/browser/store";
import type { BrowserWindow, Tab } from "../../browser/src/state/browser/types";
import type { CreateWindowOptions } from "../../browser/src/state/windows/windows";
import type { ArdiaHost } from "./host";
import { invokeHost, reportHostError } from "./host.ts";
import { engineProfile, isIncognitoProfile } from "../../browser/src/state/browser/model";
import { setPagerReach } from "./shims/web/motion/pager";

export type PrivateWindowSeed = { window: BrowserWindow; tabs: Record<string, Tab> };
type OpenOptions = Record<string, unknown> & { incognito?: boolean; profile?: string };
type ProfileStore = {
  getState(): Pick<BrowserState, "windows" | "tabs" | "profiles" | "windowOrder" | "ui" | "switchProfile" | "moveTabToProfile" | "createWindow" | "closeTabs" | "newTab">;
  setState(patch: Partial<Pick<BrowserState, "switchProfile" | "moveTabToProfile">>): void;
};

const PRIVATE_SEED_LIMIT = 1024 * 1024;
type Opening = { promise: Promise<boolean>; resolve: (opened: boolean) => void };
const openings = new Map<string, Opening>();

function settleOpening(id: string, opened: boolean) {
  const entry = openings.get(id);
  openings.delete(id);
  entry?.resolve(opened);
}

export function windowOpened(id: string): Promise<boolean> {
  let entry = openings.get(id);
  if (!entry) {
    let resolve: (opened: boolean) => void = () => {};
    const promise = new Promise<boolean>((done) => { resolve = done; });
    entry = { promise, resolve };
    openings.set(id, entry);
  }
  return entry.promise;
}

export const pendingOpenings = () => openings.size;

type RefusableStore = {
  getState(): Pick<BrowserState, "windows" | "closedWindows" | "closedTabs" | "closeWindow">;
  setState(patch: Partial<Pick<BrowserState, "closedWindows" | "closedTabs">>): void;
};

export function dropRefusedWindow(store: RefusableStore, id: string) {
  const { windows, closedWindows, closedTabs, closeWindow } = store.getState();
  if (!windows[id]) return;
  closeWindow(id);
  store.setState({ closedWindows, closedTabs });
}

export function privateWindowSeed(state: Pick<BrowserState, "windows" | "tabs">, id: string): PrivateWindowSeed | undefined {
  const w = state.windows[id];
  if (w?.kind !== "private" || !isIncognitoProfile(w.profileId)) return undefined;
  const { chromeWindow: _, ...window } = w;
  const tabs: Record<string, Tab> = {};
  for (const tabId of w.tabIds) {
    const tab = state.tabs[tabId];
    if (tab && tab.windowId === id && tab.profileId === w.profileId) tabs[tabId] = tab;
  }
  const seed = { window: { ...window, tabIds: window.tabIds.filter((tabId) => tabs[tabId]) }, tabs };
  return JSON.stringify(seed).length <= PRIVATE_SEED_LIMIT ? seed : undefined;
}

const attaching = new WeakMap<ArdiaHost, Set<string>>();

function watchAttachments(host: ArdiaHost, drop: (id: string) => void) {
  const waiting = new Set<string>();
  attaching.set(host, waiting);
  host.onEvent((module, event, payload) => {
    if (module !== "ArdiaShell" || event !== "onWindowEvent" || !payload || typeof payload !== "object") return;
    const { type, id } = payload as { type?: unknown; id?: unknown };
    if (typeof id !== "string") return;
    if (type === "refused") {
      waiting.delete(id);
      settleOpening(id, false);
      drop(id);
    } else if (type === "attached" && waiting.delete(id)) {
      settleOpening(id, true);
    }
  });
  return waiting;
}

export function createHostWindowOpener(host: ArdiaHost, state: () => Pick<BrowserState, "windows" | "tabs">, emit: (event: WindowEvent) => void, drop: (id: string) => void = () => {}) {
  const waiting = attaching.get(host) ?? watchAttachments(host, drop);
  return async (id: string, options: OpenOptions = {}) => {
    const seed = options.incognito ? privateWindowSeed(state(), id) : undefined;
    try {
      if (options.incognito && !seed) throw Object.assign(new Error("The private window has no state to open"), { code: "ERR_PROFILE_INVALID" });
      const reply = await invokeHost<{ pending?: boolean } | null>("ArdiaShell.openWindow", { args: [id, seed ? { ...options, privateWindow: seed } : options] }, host);
      if (reply?.pending === true) waiting.add(id);
      else settleOpening(id, true);
    } catch (error) {
      reportHostError(error);
      settleOpening(id, false);
      if (state().windows[id]) emit({ type: "close", id });
    }
  };
}

export function withPrivateWindow(host: ArdiaHost, session: HydrateData): HydrateData | undefined {
  const { windowId, pageProfile, privateWindow } = host.bootstrap;
  if (!pageProfile || !isIncognitoProfile(pageProfile)) return undefined;
  const w = privateWindow?.window;
  if (!w || w.id !== windowId || w.kind !== "private" || !isIncognitoProfile(w.profileId) || engineProfile({ profiles: session.profiles ?? {} }, w.profileId) !== pageProfile) {
    throw new Error("The private window state is unavailable");
  }
  const tabs = Object.fromEntries(Object.entries(privateWindow.tabs ?? {})
    .filter(([id, tab]) => tab?.id === id && tab.windowId === windowId && tab.profileId === w.profileId));
  const tabIds = w.tabIds.filter((id) => tabs[id]);
  const activeTabIds = Object.fromEntries(Object.entries(w.activeTabIds ?? {}).filter(([, id]) => tabs[id]));
  return {
    ...session,
    windows: { ...session.windows, [windowId]: { ...w, tabIds, activeTabIds } },
    windowOrder: [...new Set([...(session.windowOrder ?? []), windowId])],
    tabs: { ...session.tabs, ...tabs },
    focusedWindowId: windowId,
  };
}

const hostsOtherWindows = (w: BrowserWindow | undefined) => w?.kind === "main";
const crossesEngine = (s: Pick<BrowserState, "profiles">, windowProfile: string, profileId: string) => engineProfile(s, windowProfile) !== engineProfile(s, profileId);

export function pagesInPlace(s: Pick<BrowserState, "windows" | "profiles">, windowId: string, profileId: string) {
  const w = s.windows[windowId];
  return !hostsOtherWindows(w) || !s.profiles[profileId] || !crossesEngine(s, w!.profileId, profileId);
}

export function profileWindowFor(s: Pick<BrowserState, "windows" | "windowOrder" | "ui" | "profiles">, profileId: string): string | undefined {
  const engine = engineProfile(s, profileId);
  return [...s.ui.focusOrder, ...s.windowOrder].find((id) => hostsOtherWindows(s.windows[id]) && engineProfile(s, s.windows[id]!.profileId) === engine);
}

export function installProfileWindows(store: ProfileStore, focus: (windowId: string) => void, opened: (windowId: string) => Promise<boolean> = windowOpened) {
  const { switchProfile, moveTabToProfile } = store.getState();
  setPagerReach({
    hosts: (windowId, profileId) => pagesInPlace(store.getState(), windowId, profileId),
    route: (windowId, profileId) => store.getState().switchProfile(windowId, profileId),
  });
  store.setState({
    switchProfile(windowId, profileId) {
      const s = store.getState();
      if (pagesInPlace(s, windowId, profileId)) return switchProfile(windowId, profileId);
      const target = profileWindowFor(s, profileId);
      if (target) {
        switchProfile(target, profileId);
        focus(target);
      } else {
        s.createWindow({ profileId } satisfies CreateWindowOptions);
      }
    },
    moveTabToProfile(tabId, profileId) {
      const s = store.getState();
      const tab = s.tabs[tabId];
      const w = tab && s.windows[tab.windowId];
      if (!tab || !hostsOtherWindows(w) || !s.profiles[profileId] || !crossesEngine(s, w!.profileId, profileId)) return moveTabToProfile(tabId, profileId);
      const url = tab.url ? { url: tab.url } : {};
      const target = profileWindowFor(s, profileId);
      if (target) {
        s.newTab(target, { profileId, ...url });
        store.getState().closeTabs([tabId]);
        focus(target);
        return;
      }
      const created = s.createWindow({ profileId, ...url });
      void opened(created).then((ok) => {
        if (ok && store.getState().tabs[tabId]) store.getState().closeTabs([tabId]);
      });
    },
  });
}
