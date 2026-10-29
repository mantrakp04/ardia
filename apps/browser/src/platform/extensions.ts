import {
  call,
  extensionSearchEngines,
  on,
  type ActionPopupRequest,
  type ActionState,
  type ExtensionActionChange,
  type ExtensionInstallPrompt,
  type ExtensionPackage,
  type ExtensionsChange,
  type ExtensionsSyncApply,
  type ExtensionSyncIntent,
  type InstalledExtension,
  type SidePanelRequest,
  type TabsRequest,
} from "@ardia/ardiacore";

export { extensionSearchEngines };
export type { ExtensionsSyncApply, InstalledExtension, ActionState, ExtensionPackage, ExtensionInstallPrompt, TabsRequest };

export const listExtensions = async (profile: string) => (await call("extensions.list", { profile })).extensions;
export const inspectUnpackedExtension = (path: string) => call("extensions.inspectUnpacked", { path });
export const installExtension = async (pkg: Pick<ExtensionPackage, "path">, profile: string) =>
  (await call("extensions.install", { profile, path: pkg.path })).id;
export const installExtensionCrx = (path: string, profile: string) => call("extensions.installCrx", { profile, path });
export const chooseExtensionFolder = () => call("extensions.chooseFolder");
export const setExtensionEnabled = async (id: string, profile: string, enabled: boolean) => {
  await call("extensions.setEnabled", { profile, id, enabled });
};
export const uninstallExtension = async (id: string, profile: string) => {
  await call("extensions.uninstall", { profile, id });
};
export const reloadExtension = async (id: string, profile: string) => {
  await call("extensions.reload", { profile, id });
};
export const configureExtension = async (
  id: string,
  profile: string,
  options: {
    pinned?: boolean;
    incognito?: boolean;
    fileAccess?: boolean;
    userScripts?: boolean;
    siteAccess?: "allSites" | "specificSites" | "onClick";
  },
) => {
  await call("extensions.configure", { profile, id, options });
};
export const extensionActionStates = async (tabId: string, ids: string[]): Promise<Record<string, ActionState>> =>
  ids.length ? call("extensions.actionStates", { tabId, ids }) : {};
export const watchExtensionActions = (profile: string) => call("extensions.watchActions", { profile });
export const resolveExtensionInstallPrompt = (requestId: string, accepted: boolean) => call("extensions.resolveInstallPrompt", { requestId, accepted });
export const extensionSidePanelUrl = (tabId: string, extensionId: string) => call("extensions.sidePanelUrl", { tabId, extensionId });
export const extensionsSyncState = (profile: string) => call("extensions.syncState", { profile });
export const applyExtensionsSync = (profile: string, apply: ExtensionsSyncApply) => call("extensions.syncApply", { ...apply, profile });

export const onExtensionsChanged = (listener: (e: ExtensionsChange) => void) => on("extensions.changed", listener);
export const onExtensionActionChanged = (listener: (e: ExtensionActionChange) => void) => on("extensions.action", listener);
export const onExtensionInstallPrompt = (listener: (e: ExtensionInstallPrompt) => void) => on("extensions.installPrompt", listener);
export const onExtensionInstallFailed = (listener: (e: { message: string; tabId: string | null }) => void) => on("extensions.installFailed", listener);
export const onExtensionTabsRequest = (listener: (e: TabsRequest) => void) => on("extensions.tabs", listener);
export const onExtensionSidePanel = (listener: (e: SidePanelRequest) => void) => on("extensions.sidePanel", listener);
export const onExtensionActionPopup = (listener: (e: ActionPopupRequest) => void) => on("extensions.actionPopup", listener);
export const onExtensionActionShortcut = (listener: (e: ActionPopupRequest) => void) => on("extensions.actionShortcut", listener);
export const onExtensionsSync = (listener: (p: { profile: string } & ExtensionSyncIntent) => void) => on("extensions.sync", listener);
