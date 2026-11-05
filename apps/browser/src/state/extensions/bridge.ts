import { onExtensionActionPopup, onExtensionActionShortcut, onExtensionSidePanel, onExtensionsChanged, onExtensionTabsRequest } from "../../platform/extensions";
import { useBrowser, type BrowserState } from "../browser/store";
import { shownPageId } from "../peek/peek";
import { startActionStates, watchActionsOf } from "./actionWatch";
import { startExtensionSearchEngines } from "./searchEngines";
import { watchExtensionInstallFailures } from "./crxDrop";
import { onSyncedExtensionChange } from "../sync/extensions";
import { openRequestedTab } from "./tabsRequests";
import { pruneToolbarAnchors, toolbarAnchor } from "./toolbarAnchors";
import { startWebStoreIntegration } from "./webStore";
import * as state from "./actions";
import {
  activateExtension,
  closeExtensionPopup,
  closeSidePanel,
  extensionProfile,
  findExtension,
  openSidePanel,
  refreshExtensions,
  refreshExtensionsAfterChange,
  wantedSidePanels,
  syncSidePanel,
  useExtensions,
  windowExtensions,
} from "./actions";

export function startExtensionsBridge() {
  onExtensionTabsRequest(openRequestedTab);
  startExtensionSearchEngines();
  onExtensionsChanged(({ profile }) => void refreshExtensions(profile));
  onSyncedExtensionChange((profile) => void refreshExtensionsAfterChange(profile));

  const loadProfiles = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const profile = extensionProfile(s, id);
      if (watchActionsOf(profile)) void refreshExtensions(profile);
    }
  };
  loadProfiles(useBrowser.getState());
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows) loadProfiles(s);
    if (s.windows !== prev.windows || s.tabs !== prev.tabs) pruneToolbarAnchors(s);
  });

  startActionStates();
  startSidePanels();
  startActionPopups();
  startWebStoreIntegration();
  watchExtensionInstallFailures();
  if (__DEV__) Object.assign(globalThis, { acExtensionsApp: { ...state, bridge: { openExtensionFromMenu } } });
}

export function openExtensionFromMenu(windowId: string, extensionId: string, tabId?: string) {
  const ext = findExtension(extensionProfile(useBrowser.getState(), windowId), extensionId);
  if (ext) void activateExtension(windowId, ext, toolbarAnchor(windowId, ext.id, tabId), undefined, tabId);
}

function startActionPopups() {
  onExtensionActionPopup(({ tabId, extensionId }) => {
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (!tabId || !windowId) return console.warn(`action.openPopup for ${extensionId}: ${tabId ? "its tab has no window" : "no app tab"}`);
    void state.openActionPopup(windowId, extensionId, toolbarAnchor(windowId, extensionId, tabId), tabId);
  });
  onExtensionActionShortcut(({ tabId, extensionId }) => {
    const windowId = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (windowId) openExtensionFromMenu(windowId, extensionId, tabId ?? undefined);
  });
}

function startSidePanels() {
  onExtensionSidePanel(({ tabId, extensionId, open }) => {
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

