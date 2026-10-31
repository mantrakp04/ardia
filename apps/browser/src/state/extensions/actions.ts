import { errorText } from "../../lib/errors";
import {
  chooseExtensionFolder,
  configureExtension,
  extensionActionStates,
  inspectUnpackedExtension,
  installExtension,
  listExtensions,
  resolveExtensionInstallPrompt,
  setExtensionEnabled,
  uninstallExtension,
  type ActionState,
  type ExtensionInstallPrompt,
  type InstalledExtension,
} from "../../platform/extensions";
import { webStoreExtensionId } from "@ardia/core";
import { confirm } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import type { ChoiceItem } from "../app/menuChoice";
import { menuSections } from "../app/menuSections";
import { openWindow } from "../browser/actions";
import { webviews } from "../../platform/webviews";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfileForSpace } from "../browser/model";
import { shownPageId } from "../peek/peek";
import { goToSettingsPane, openProfileSettings, replaceSettingsPlace, settingsBack, useSettingsNav } from "../settings/settingsWindows";
import { closeSidePanelsOf, toggleSidePanel } from "./sidePanels";
import { extensionPageUrl, extensionSpace, extensionsProfileId, pageSpace, shownIn, useExtensions, windowExtensions, readyTabOf, type Anchor } from "./store";

export { reloadExtension } from "../../platform/extensions";

export * from "./sidePanels";
export * from "./store";

const EMPTY: InstalledExtension[] = [];

const loading = new Map<string, Promise<InstalledExtension[]>>();

export function refreshExtensions(profile: string): Promise<InstalledExtension[]> {
  const running = loading.get(profile);
  if (running) return running;
  const job = listExtensions(profile)
    .then((list) => {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      useExtensions.setState((e) => ({ lists: { ...e.lists, [profile]: list } }));
      return list;
    })
    .catch((error) => {
      console.warn("[extensions] list failed", error);
      return useExtensions.getState().lists[profile] ?? EMPTY;
    })
    .finally(() => loading.delete(profile));
  loading.set(profile, job);
  return job;
}

const trailing = new Map<string, Promise<InstalledExtension[]>>();

export function refreshExtensionsAfterChange(profile: string): Promise<InstalledExtension[]> {
  const running = loading.get(profile);
  if (!running) return refreshExtensions(profile);
  let next = trailing.get(profile);
  if (!next) {
    next = running.then(() => {
      trailing.delete(profile);
      return refreshExtensions(profile);
    });
    trailing.set(profile, next);
  }
  return next;
}

export const findExtension = (profile: string, id: string) => useExtensions.getState().lists[profile]?.find((x) => x.id === id);

export function addFromWebStore(windowId: string, urlOrId: string, space = extensionSpace(useBrowser.getState(), windowId)) {
  const id = webStoreExtensionId(urlOrId);
  if (!id) {
    useExtensions.setState({ install: { windowId, profile: space, source: "webStore", status: "error", error: "That isn't a link to an extension in the Chrome Web Store." } });
    return;
  }
  const url = `https://chromewebstore.google.com/detail/${id}`;
  const s = useBrowser.getState();
  const target = s.windows[windowId] ? windowId : s.ui.focusOrder.find((w) => s.windows[w] && extensionSpace(s, w) === space && s.windows[w]!.kind !== "private");
  if (target) s.newTab(target, { url });
  else openWindow({ spaceId: s.spaceOrder.find((p) => engineProfileForSpace(p) === space), url });
}

export async function loadUnpacked(windowId: string, space = extensionSpace(useBrowser.getState(), windowId)): Promise<boolean> {
  const path = await chooseExtensionFolder();
  if (!path) return false;
  try {
    const pkg = await inspectUnpackedExtension(path);
    useExtensions.setState({ install: { windowId, profile: space, source: "unpacked", status: "ready", pkg } });
  } catch (error) {
    useExtensions.setState({ install: { windowId, profile: space, source: "unpacked", status: "error", error: errorText(error) } });
  }
  return true;
}

export function showInstallPrompt(windowId: string, prompt: ExtensionInstallPrompt) {
  const current = useExtensions.getState().install;
  if (current?.status === "prompt") void resolveExtensionInstallPrompt(current.prompt.requestId, false);
  else cancelInstall();
  useExtensions.setState({ install: { windowId, profile: prompt.profile, source: "webStore", status: "prompt", prompt } });
}

export async function confirmInstall() {
  const request = useExtensions.getState().install;
  if (request?.status === "prompt") {
    useExtensions.setState({ install: null });
    await resolveExtensionInstallPrompt(request.prompt.requestId, true);
    for (const ms of [1500, 5000]) setTimeout(() => void refreshExtensions(request.profile), ms);
    return;
  }
  if (request?.status !== "ready") return;
  useExtensions.setState({ install: { ...request, status: "installing" } });
  try {
    await installExtension(request.pkg, request.profile);
    useExtensions.setState({ install: null });
    await refreshExtensions(request.profile);
  } catch (error) {
    useExtensions.setState({ install: { windowId: request.windowId, profile: request.profile, source: request.source, status: "error", error: errorText(error) } });
  }
}

export function cancelInstall() {
  const request = useExtensions.getState().install;
  if (!request) return;
  if (request.status === "prompt") void resolveExtensionInstallPrompt(request.prompt.requestId, false);
  useExtensions.setState({ install: null });
}

export async function removeExtension(profile: string, ext: InstalledExtension, windowId?: string) {
  const { confirmed } = await confirm({
    title: `Remove “${ext.name}”?`,
    message: ext.fromWebStore ? "Its data and settings will be removed too." : "The extension's folder stays on your Mac.",
    confirmTitle: "Remove",
    destructive: true,
    windowId,
  });
  if (!confirmed) return;
  if (useExtensions.getState().popup?.extensionId === ext.id) closeExtensionPopup();
  closeSidePanelsOf(ext.id);
  try {
    await uninstallExtension(ext.id, profile);
  } finally {
    await refreshExtensions(profile);
  }
}

export async function setEnabled(profile: string, id: string, enabled: boolean) {
  patchExtension(profile, id, { enabled, state: enabled ? "ENABLED" : "DISABLED" });
  try {
    await setExtensionEnabled(id, profile, enabled);
  } finally {
    await refreshExtensions(profile);
  }
}

export async function setPinned(profile: string, id: string, pinned: boolean) {
  patchExtension(profile, id, { pinned });
  try {
    await configureExtension(id, profile, { pinned });
  } catch {
    await refreshExtensions(profile);
  }
}

export async function configure(profile: string, id: string, options: Parameters<typeof configureExtension>[2]) {
  try {
    await configureExtension(id, profile, options);
  } finally {
    await refreshExtensions(profile);
  }
}

function patchExtension(profile: string, id: string, patch: Partial<InstalledExtension>) {
  useExtensions.setState((e) => ({
    lists: { ...e.lists, [profile]: (e.lists[profile] ?? EMPTY).map((x) => (x.id === id ? { ...x, ...patch } : x)) },
  }));
}

export function openOptions(windowId: string, ext: InstalledExtension) {
  if (ext.optionsUrl) useBrowser.getState().newTab(windowId, { url: ext.optionsUrl });
}

export const openManageExtensions = (windowId?: string | null) => openProfileSettings("extensions", extensionsProfileId(null, windowId));

export function openExtensionDetails(profileId: string, extensionId: string) {
  if (useSettingsNav.getState().spaceId !== profileId) replaceSettingsPlace(profileId);
  goToSettingsPane("extensions", profileId, extensionId);
}

export function showExtensionsList(profileId: string) {
  const prev = useSettingsNav.getState().back.at(-1);
  if (prev?.pane === "extensions" && !prev.detail && prev.spaceId === profileId) settingsBack();
  else goToSettingsPane("extensions", profileId);
}
export const openPinDialog = (windowId: string) => useExtensions.setState({ pinDialog: { windowId } });
export const openWebStore = (windowId: string) =>
  useBrowser.getState().newTab(windowId, { url: "https://chromewebstore.google.com/category/extensions" });

export async function activateExtension(
  windowId: string,
  ext: InstalledExtension,
  anchor: Anchor,
  state?: ActionState | null,
  tabId = shownPageId(useBrowser.getState(), windowId),
) {
  const current = useExtensions.getState().popup;
  if (current?.windowId === windowId && current.extensionId === ext.id) return closeExtensionPopup();
  if (!ext.enabled) return void showExtensionMenu(windowId, ext);
  if (!shownIn(windowId, ext.id)) return;
  const web = tabId ? webviews.get(tabId) : undefined;
  const result = web ? await web.executeExtensionAction(ext.id) : null;
  const readyTab = readyTabOf(tabId);
  if (!state && result === "popup" && readyTab) state = (await extensionActionStates(readyTab, [ext.id]))[ext.id];
  const url = state ? state.popup : ext.popup ? extensionPageUrl(ext.id, ext.popup) : "";
  if (result === "none") return;
  if (result === "sidePanel") return void toggleSidePanel(windowId, ext.id);
  if (!url) return void (result === null && showExtensionMenu(windowId, ext));
  useExtensions.setState({ popup: { windowId, pageSpace: pageSpace(useBrowser.getState(), windowId), extensionId: ext.id, url, anchor } });
}

export const closeExtensionPopup = () => useExtensions.setState({ popup: null });

let popupRequests = 0;

export async function openActionPopup(windowId: string, extensionId: string, anchor: Anchor, sourceTabId: string) {
  const request = ++popupRequests;
  const tabId = shownPageId(useBrowser.getState(), windowId);
  const url = (await extensionActionStates(sourceTabId, [extensionId]))[extensionId]?.popup ?? "";
  if (request !== popupRequests || shownPageId(useBrowser.getState(), windowId) !== tabId)
    return console.warn(`action.openPopup for ${extensionId}: the tab changed or another call came first`);
  if (!url) return console.warn(`action.openPopup for ${extensionId}: no popup for the tab`);
  useExtensions.setState({ popup: { windowId, pageSpace: pageSpace(useBrowser.getState(), windowId), extensionId, url, anchor, opened: request } });
}

export function extensionMenuItems(ext: Pick<InstalledExtension, "name" | "enabled" | "pinned" | "optionsUrl" | "sidePanel" | "mayModify">, sidePanelOpen: boolean): MenuItem[] {
  return menuSections(
    [{ id: "name", title: ext.name, enabled: false }],
    [
      { id: "options", title: "Options", symbol: "gearshape", enabled: !!ext.optionsUrl && ext.enabled },
      !!ext.sidePanel && ext.enabled && { id: "sidePanel", title: sidePanelOpen ? "Close Side Panel" : "Open Side Panel", symbol: "sidebar.right" },
      { id: "pin", title: ext.pinned ? "Unpin from Toolbar" : "Pin to Toolbar", symbol: ext.pinned ? "pin.slash" : "pin" },
    ],
    [
      { id: "enable", title: ext.enabled ? "Turn Off" : "Turn On", symbol: "power" },
      { id: "manage", title: "Manage Extension", symbol: "puzzlepiece.extension" },
    ],
    [{ id: "remove", title: "Remove Extension…", symbol: "trash", enabled: ext.mayModify }],
  );
}

export async function showExtensionMenu(windowId: string, ext: InstalledExtension) {
  const space = extensionSpace(useBrowser.getState(), windowId);
  const choice = await showMenu(extensionMenuItems(ext, useExtensions.getState().sidePanels[windowId]?.extensionId === ext.id));
  if (choice === "options") openOptions(windowId, ext);
  if (choice === "pin") void setPinned(space, ext.id, !ext.pinned);
  if (choice === "enable") void setEnabled(space, ext.id, !ext.enabled);
  if (choice === "remove") void removeExtension(space, ext, windowId);
  if (choice === "sidePanel") void toggleSidePanel(windowId, ext.id);
  if (choice === "manage") {
    openExtensionDetails(extensionsProfileId(null, windowId), ext.id);
    openProfileSettings("extensions", extensionsProfileId());
  }
}

export type ExtensionListChoice = "add" | "manage" | "pin";

export const EXTENSION_LIST_ITEMS: ChoiceItem<never, ExtensionListChoice>[] = [
  { id: "add", title: "Add Extension…", symbol: "plus" },
  { id: "manage", title: "Manage Extensions…", symbol: "puzzlepiece.extension" },
  { id: "pin", title: "Pin Extensions…", symbol: "pin" },
];

export function runExtensionListChoice(choice: ExtensionListChoice | null, windowId: string) {
  if (choice === "add") openWebStore(windowId);
  if (choice === "manage") openManageExtensions(windowId);
  if (choice === "pin") openPinDialog(windowId);
}

export function extensionMenu(s: BrowserState, windowId: string | undefined) {
  return windowExtensions(s, windowId).map((x) => ({ id: x.id, title: x.name, icon: x.actionIcon || x.icon, enabled: true }));
}

if (__DEV__) (globalThis as { acExtensionsUi?: unknown }).acExtensionsUi = { useExtensions, confirmInstall, cancelInstall, activateExtension };

export const closePinDialog = () => useExtensions.setState({ pinDialog: null });

export const currentWindowExtensions = (windowId: string) => windowExtensions(useBrowser.getState(), windowId);
