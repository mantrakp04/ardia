import {
  onExtensionInstallPrompt,
  onExtensionActionChanged,
  onExtensionActionPopup,
  onExtensionActionShortcut,
  onExtensionSidePanel,
  onExtensionsChanged,
  onExtensionTabsRequest,
  resolveExtensionInstallPrompt,
  watchExtensionActions,
  webStoreExtensionId,
  type TabsRequest,
} from "@ardia/ardiacore";
import { killSwitchEnvironment } from "@ardia/shell";
import { AppState } from "react-native";
import { openWindow } from "../../lib/actions";
import { webviews } from "../../lib/webviews";
import { useBrowser, type BrowserState } from "../../store/browser";
import { changedIds } from "../../store/changes";
import { activeTabId, engineProfile } from "../../store/model";
import { shownPageId } from "../../store/peek";
import { tabForBrowser, usePages } from "../layout/pageState";
import { refreshActionStates } from "./actions";
import { startExtensionSearchEngines } from "./searchEngines";
import * as state from "./state";
import {
  activateExtension,
  closeExtensionPopup,
  closeSidePanel,
  extensionProfile,
  findExtension,
  openSidePanel,
  refreshExtensions,
  refreshExtensionsAfterChange,
  showInstallPrompt,
  wantedSidePanels,
  syncSidePanel,
  useExtensions,
  windowExtensions,
} from "./state";
import { PRODUCT } from "../../lib/productName";

export function startExtensionsBridge() {
  onExtensionTabsRequest(openRequestedTab);
  startExtensionSearchEngines();
  onExtensionsChanged(({ profile }) => void refreshExtensions(profile));

  const loadProfiles = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const profile = extensionProfile(s, id);
      if (loadedProfiles.has(profile)) continue;
      loadedProfiles.add(profile);
      void refreshExtensions(profile);
      watchActionsOf(profile);
    }
  };
  loadProfiles(useBrowser.getState());
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows) loadProfiles(s);
  });

  startActionStates();
  startSidePanels();
  startActionPopups();
  startWebStoreIntegration();
  if (__DEV__) Object.assign(globalThis, { acExtensionsApp: { ...state, bridge: { openExtensionFromMenu } } });
}

function openRequestedTab(request: TabsRequest) {
  if (request.action === "closeWindow") return closeChromeMadeWindow(request.chromeWindow);
  if (request.chromeWindow && request.tabKey) return moveIntoChromeMadeWindow(request, request.chromeWindow, request.tabKey);
  if (request.chromeWindow && request.adoptId) return openChromeMadeTab(request, request.chromeWindow, request.adoptId);
  if (!request.url) return;
  const s = useBrowser.getState();
  const ofProfile = (id: string) => !!s.windows[id] && !s.windows[id]!.incognito && engineProfile(s.windows[id]!.profileId) === request.profile;
  const windowId =
    (request.window && s.windows[request.window] ? request.window : undefined) ??
    s.ui.focusOrder.find(ofProfile) ??
    s.ui.focusOrder.find((id) => s.windows[id]);
  const background = request.active === false;
  const profileId = request.adoptId
    ? windowId && ofProfile(windowId) ? s.windows[windowId]!.profileId : s.profileOrder.find((p) => engineProfile(p) === request.profile)
    : undefined;
  if (request.adoptId && profileId) {
    if (windowId && ofProfile(windowId)) s.newTab(windowId, { url: request.url, adoptId: request.adoptId, profileId, background });
    else openWindow({ url: request.url, adoptId: request.adoptId, profileId });
    return;
  }
  if (windowId) s.newTab(windowId, { url: request.url, background });
  else openWindow({ url: request.url });
}

function openChromeMadeTab(request: TabsRequest, chromeWindow: string, adoptId: string) {
  const s = useBrowser.getState();
  const made = Object.values(s.windows).find((w) => w.chromeWindow === chromeWindow);
  if (made) return void s.newTab(made.id, { url: request.url, adoptId, profileId: made.profileId, background: request.active === false });
  const profileId = s.profileOrder.find((p) => engineProfile(p) === request.profile);
  if (!profileId) return void openWindow({ url: request.url, adoptId });
  openWindow({ url: request.url, adoptId, profileId, chromeWindow, background: request.focused === false });
}

function closeChromeMadeWindow(chromeWindow: string | undefined) {
  const s = useBrowser.getState();
  const made = chromeWindow ? Object.values(s.windows).find((w) => w.chromeWindow === chromeWindow) : undefined;
  if (made) s.closeWindow(made.id);
}

function moveIntoChromeMadeWindow(request: TabsRequest, chromeWindow: string, tabId: string) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!tab) return;
  const made = Object.values(s.windows).find((w) => w.chromeWindow === chromeWindow);
  if (made) return void s.moveTabsToWindow([tabId], made.id);
  s.createWindow({ profileId: tab.profileId, tabIds: [tabId], chromeWindow, background: request.focused === false });
}

export function openExtensionFromMenu(windowId: string, extensionId: string, tabId?: string) {
  const ext = findExtension(extensionProfile(useBrowser.getState(), windowId), extensionId);
  if (ext) void activateExtension(windowId, ext, toolbarAnchor(windowId, ext.id), undefined, tabId);
}

export const toolbarAnchors = new Map<string, import("./state").Anchor>();
function toolbarAnchor(windowId: string, extensionId: string) {
  return toolbarAnchors.get(`${windowId}|${extensionId}`) ?? toolbarAnchors.get(`${windowId}|*`) ?? { x: 100_000, y: 13, width: 28, height: 28 };
}

const ACTION_POLL_MS = 1500;
const ACTION_EVENT_COALESCE_MS = 150;

function refreshActionsAndPanels() {
  void refreshActionStates();
  for (const [windowId] of wantedSidePanels()) void syncSidePanel(windowId);
}

let actionPoll: ReturnType<typeof setInterval> | null = null;
function pollActionStates() {
  actionPoll ??= setInterval(() => {
    if (AppState.currentState === "active") refreshActionsAndPanels();
  }, ACTION_POLL_MS);
}

const pollsActions = () => killSwitchEnvironment("ARDIA_EXTENSION_ACTION_POLL") === "on";

function watchActionsOf(profile: string) {
  if (pollsActions()) return pollActionStates();
  void watchExtensionActions(profile).then((watching) => watching || pollActionStates());
}

const loadedProfiles = new Set<string>();
const dirtyActions = new Set<string>();
const dirtyLists = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const windowsOf = (s: BrowserState, profile: string) => s.windowOrder.filter((windowId) => extensionProfile(s, windowId) === profile);

function showsAction(profile: string, extensionId: string) {
  const s = useBrowser.getState();
  const popup = useExtensions.getState().popup;
  const windows = windowsOf(s, profile);
  if (wantedSidePanels().some(([windowId, id]) => id === extensionId && windows.includes(windowId))) return true;
  return windows.some((windowId) => windowExtensions(s, windowId).some((x) => x.id === extensionId && (x.pinned || popup?.extensionId === x.id)));
}

function flushActionChanges() {
  flushTimer = null;
  if (AppState.currentState !== "active") return;
  for (const profile of dirtyLists) if (loadedProfiles.has(profile)) void refreshExtensionsAfterChange(profile);
  dirtyLists.clear();
  if (dirtyActions.size) {
    const profiles = [...dirtyActions];
    dirtyActions.clear();
    void refreshActionStates(profiles);
    const s = useBrowser.getState();
    for (const [windowId] of wantedSidePanels()) if (profiles.includes(extensionProfile(s, windowId))) void syncSidePanel(windowId);
  }
}

function flushSoon() {
  if (AppState.currentState !== "active" || (!dirtyActions.size && !dirtyLists.size)) return;
  flushTimer ??= setTimeout(flushActionChanges, ACTION_EVENT_COALESCE_MS);
}

function startActionStates() {
  onExtensionActionChanged(({ profile, id, kind }) => {
    if (kind === "registry") dirtyLists.add(profile);
    else if (showsAction(profile, id)) dirtyActions.add(profile);
    else return;
    flushSoon();
  });
  AppState.addEventListener("change", (state) => state === "active" && flushSoon());
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.ui.focusedWindowId !== prev.ui.focusedWindowId) return void refreshActionStates();
    if (s.tabs === prev.tabs) return;
    if (s.windowOrder.some((id) => { const active = activeTabId(s, id); return !!active && s.tabs[active] !== prev.tabs[active]; })) void refreshActionStates();
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists || e.popup !== prev.popup) void refreshActionStates();
  });
  usePages.subscribe((p, prev) => {
    if (p.browsers === prev.browsers) return;
    void refreshActionStates();
    const actions = useExtensions.getState().actions;
    const gone = Object.keys(actions).filter((id) => !p.browsers[Number(id)]);
    if (!gone.length) return;
    const next = { ...actions };
    for (const id of gone) delete next[Number(id)];
    useExtensions.setState({ actions: next });
  });
}

function startActionPopups() {
  onExtensionActionPopup(({ browserId, extensionId }) => {
    const tabId = tabForBrowser(browserId);
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (!windowId) return console.warn(`action.openPopup for ${extensionId}: ${tabId ? "its tab has no window" : `no tab for browser ${browserId}`}`);
    void state.openActionPopup(windowId, extensionId, toolbarAnchor(windowId, extensionId), browserId);
  });
  onExtensionActionShortcut(({ browserId, extensionId }) => {
    const tabId = tabForBrowser(browserId);
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (windowId) openExtensionFromMenu(windowId, extensionId, tabId);
  });
}

function startSidePanels() {
  onExtensionSidePanel(({ browserId, extensionId, open }) => {
    const tabId = tabForBrowser(browserId);
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (!windowId) return;
    if (open) void openSidePanel(windowId, extensionId);
    else closeSidePanel(windowId, extensionId);
  });
  const active = (s: BrowserState) => s.windowOrder.map((id) => `${id}:${shownPageId(s, id) ?? ""}`).join(",");
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.tabs === prev.tabs) return;
    if (active(s) === active(prev)) return;
    for (const [windowId] of wantedSidePanels()) {
      if (!s.windows[windowId]) closeSidePanel(windowId);
      else void syncSidePanel(windowId);
    }
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists === prev.lists) return;
    const s = useBrowser.getState();
    for (const [windowId, extensionId] of wantedSidePanels()) {
      if (!windowExtensions(s, windowId).some((x) => x.id === extensionId)) closeSidePanel(windowId);
    }
    if (e.popup && !windowExtensions(s, e.popup.windowId).some((x) => x.id === e.popup!.extensionId)) closeExtensionPopup();
  });
}

const STORE_SCRIPT = `
const g = window;
if (!g.__ardiaStore) {
  const store = (g.__ardiaStore = { waiting: null, queued: [] });
  const request = (id) => {
    if (!id) return;
    if (store.waiting) { const w = store.waiting; store.waiting = null; w(id); } else store.queued.push(id);
  };
  // "Remove from Chrome" would bring up Chrome's own dialog.
  const mg = g.chrome && g.chrome.management;
  if (mg && typeof mg.uninstall === "function") {
    Object.defineProperty(mg, "uninstall", { configurable: true, writable: true, value: (id, options, callback) => {
      request(id);
      const done = typeof options === "function" ? options : callback;
      if (typeof done === "function") { setTimeout(done); return; }
      return Promise.resolve();
    } });
  }
  const relabel = () => {
    for (const el of document.querySelectorAll("button, button *")) {
      if (el.childElementCount) continue;
      const t = el.textContent;
      if (t === "Add to Chrome") el.textContent = ${JSON.stringify(`Add to ${PRODUCT}`)};
      else if (t === "Remove from Chrome") el.textContent = ${JSON.stringify(`Remove from ${PRODUCT}`)};
    }
  };
  relabel();
  new MutationObserver(relabel).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
}
const store = g.__ardiaStore;
if (store.queued.length) post("result", JSON.stringify(store.queued.shift()));
else store.waiting = (id) => post("result", JSON.stringify(id));
`;

const isStorePage = (url: string | undefined) => !!url && /^https:\/\/chromewebstore\.google\.com\//.test(url);

function startWebStoreIntegration() {
  onExtensionInstallPrompt((prompt) => {
    const s = useBrowser.getState();
    const tabId = prompt.browserId ? tabForBrowser(prompt.browserId) : undefined;
    const windowId = (tabId && s.tabs[tabId]?.windowId) || s.ui.focusedWindowId || s.windowOrder[0];
    if (windowId) showInstallPrompt(windowId, prompt);
    else void resolveExtensionInstallPrompt(prompt.requestId, false);
  });
  const listening = new Map<string, string>();
  const listen = (tabId: string, url: string) => {
    listening.set(tabId, url);
    const web = webviews.get(tabId);
    if (!web) return void listening.delete(tabId);
    void web.evaluate<string>(STORE_SCRIPT).then((id) => {
      const s = useBrowser.getState();
      const tab = s.tabs[tabId];
      if (!tab || listening.get(tabId) !== url) return;
      const profile = extensionProfile(s, tab.windowId);
      const ext = id && webStoreExtensionId(id) ? findExtension(profile, id) : undefined;
      if (ext) void state.removeExtension(profile, ext, tab.windowId);
      if (tab.url === url) listen(tabId, url);
    });
  };
  const sync = (s: BrowserState, prev?: BrowserState) => {
    for (const [tabId, url] of listening) if (s.tabs[tabId]?.url !== url || s.live[tabId]?.isLoading) listening.delete(tabId);
    const ids = prev ? new Set([...changedIds(s.tabs, prev.tabs), ...changedIds(s.live, prev.live)]) : Object.keys(s.tabs);
    for (const id of ids) {
      const tab = s.tabs[id];
      if (!tab || !isStorePage(tab.url) || s.live[id]?.isLoading || listening.get(id) === tab.url) continue;
      listen(id, tab.url);
    }
  };
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.live !== prev.live) sync(s, prev);
  });
  sync(useBrowser.getState());
}
