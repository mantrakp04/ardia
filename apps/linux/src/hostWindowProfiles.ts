import type { WindowEvent } from "@ardia-real/shell";
import type { BrowserState, HydrateData } from "../../browser/src/state/browser/store";
import type { BrowserWindow, Tab } from "../../browser/src/state/browser/types";
import type { ArdiaHost } from "./host";
import { invokeHost, reportHostError } from "./host.ts";
import { engineProfile, isIncognitoProfile } from "../../browser/src/state/browser/model";

export type PrivateWindowSeed = { window: BrowserWindow; tabs: Record<string, Tab> };
type OpenOptions = Record<string, unknown> & { incognito?: boolean; profile?: string };

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

export type ActiveProfileStore = {
  getState(): Pick<BrowserState, "windows" | "profiles">;
  subscribe(listener: (state: Pick<BrowserState, "windows" | "profiles">) => void): () => void;
};

export function activeEngineProfile(s: Pick<BrowserState, "windows" | "profiles">, windowId: string): string | undefined {
  const w = s.windows[windowId];
  if (!w || w.kind === "private" || isIncognitoProfile(w.profileId)) return undefined;
  return engineProfile(s, w.profileId);
}

export function watchActiveProfile(host: ArdiaHost, store: ActiveProfileStore, windowId = host.bootstrap.windowId) {
  let sent: string | undefined;
  let sequence = 0;
  const select = (s: Pick<BrowserState, "windows" | "profiles">) => {
    const engine = activeEngineProfile(s, windowId);
    if (engine === undefined || engine === sent) return;
    sent = engine;
    void invokeHost("ArdiaShell.setActiveProfile", { args: [engine, ++sequence] }, host).catch((error) => {
      if (sent === engine) sent = undefined;
      reportHostError(error);
    });
  };
  select(store.getState());
  return store.subscribe(select);
}
