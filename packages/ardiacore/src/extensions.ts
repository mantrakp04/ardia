import { call, on } from "./engine/call";

export type SiteAccess = "ON_ALL_SITES" | "ON_SPECIFIC_SITES" | "ON_CLICK";

export type InstalledExtension = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  state: "ENABLED" | "DISABLED" | "TERMINATED" | "BLOCKLISTED";
  icon: string;
  permissions: string[];
  siteAccess: SiteAccess | null;
  sites: string[];
  optionsUrl: string | null;
  pinned: boolean;
  incognito: boolean;
  incognitoSplit?: boolean;
  fileAccess: boolean;
  mayModify: boolean;
  blockedByPolicy?: boolean;
  errors: string[];
  location: string;
  path: string | null;
  fromWebStore: boolean;
  webStoreUrl: string | null;
  homepageUrl: string | null;
  hasAction?: boolean;
  popup?: string | null;
  actionTitle?: string | null;
  actionIcon?: string | null;
  sidePanel?: string | null;
};

export type ExtensionPackage = {
  id?: string;
  name: string;
  shortName?: string | null;
  version: string;
  description: string;
  manifestVersion: number;
  icon: string | null;
  permissions: string[];
  optionalPermissions: string[];
  hostPermissions: string[];
  hasAction: boolean;
  popup: string | null;
  optionsPage: string | null;
  sidePanel: string | null;
  path: string;
};

export type ActionState = {
  badgeText: string;
  badgeColor: string | null;
  badgeTextColor: string | null;
  title: string;
  popup: string;
  enabled: boolean;
  icon: string;
};

export type ExtensionsChange = {
  profile: string;
  id: string;
  event: "installed" | "uninstalled" | "enabled" | "disabled" | "configured" | "reloaded";
};

export type TabsRequest = {
  action: "open" | "closeWindow";
  profile: string;
  extensionId: string;
  window: string | null;
  url: string;
  active?: boolean;
  adoptId?: string;
  chromeWindow?: string;
  focused?: boolean;
  tabId?: string;
};

export type ExtensionInstallPrompt = {
  requestId: string;
  profile: string;
  id: string;
  name: string;
  version: string;
  type: "install" | "re-enable" | "permissions" | "external" | "remote" | "repair" | "other";
  icon: string;
  permissions: string[];
  tabId: string | null;
};

export const isExtensionId = (s: string) => /^[a-p]{32}$/.test(s);

export function webStoreExtensionId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  if (isExtensionId(s)) return s;
  try {
    const url = new URL(s);
    const store =
      url.hostname === "chromewebstore.google.com" ||
      (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore/"));
    if (!store) return null;
    const id = url.pathname.split("/").find(isExtensionId);
    return id ?? null;
  } catch {
    return null;
  }
}

export async function searchEngineList(profile: string): Promise<unknown> {
  return (await call("search.engines", { profile })).list;
}

export async function listExtensions(profile: string): Promise<InstalledExtension[]> {
  return (await call("extensions.list", { profile })).extensions;
}

export const inspectUnpackedExtension = (path: string): Promise<ExtensionPackage> => call("extensions.inspectUnpacked", { path });

export async function installExtension(pkg: Pick<ExtensionPackage, "path">, profile: string): Promise<string> {
  return (await call("extensions.install", { profile, path: pkg.path })).id;
}

export async function setExtensionEnabled(id: string, profile: string, enabled: boolean) {
  await call("extensions.setEnabled", { profile, id, enabled });
}

export async function uninstallExtension(id: string, profile: string) {
  await call("extensions.uninstall", { profile, id });
}

export async function reloadExtension(id: string, profile: string) {
  await call("extensions.reload", { profile, id });
}

export async function configureExtension(
  id: string,
  profile: string,
  options: {
    pinned?: boolean;
    incognito?: boolean;
    fileAccess?: boolean;
    siteAccess?: "allSites" | "specificSites" | "onClick";
  },
) {
  await call("extensions.configure", { profile, id, options });
}

export async function extensionActionStates(tabId: string, ids: string[]): Promise<Record<string, ActionState>> {
  if (!ids.length) return {};
  return call("extensions.actionStates", { tabId, ids });
}

export const onExtensionsChanged = (listener: (e: ExtensionsChange) => void) => on("extensions.changed", listener);

export const watchExtensionActions = (profile: string) => call("extensions.watchActions", { profile });

export type ExtensionActionChange = { profile: string; id: string; kind: "action" | "sidePanel" | "registry" };

export const extensionActionChange = (p: { profile: string } & Record<string, unknown>): ExtensionActionChange => ({
  profile: p.profile,
  id: String(p.id),
  kind: p.kind === "sidePanel" || p.kind === "registry" ? p.kind : "action",
});

export const onExtensionActionChanged = (listener: (e: ExtensionActionChange) => void) =>
  on("extensions.action", (p) => {
    if (typeof p.id === "string") listener(extensionActionChange(p));
  });
export const onExtensionInstallPrompt = (listener: (e: ExtensionInstallPrompt) => void) => on("extensions.installPrompt", listener);
export const resolveExtensionInstallPrompt = (requestId: string, accepted: boolean) => call("extensions.resolveInstallPrompt", { requestId, accepted });
export const onExtensionTabsRequest = (listener: (e: TabsRequest) => void) => on("extensions.tabs", listener);
export const onExtensionsSync = (listener: (p: { profile: string }) => void) => on("extensions.sync", listener);
export const extensionsSyncState = <T,>(profile: string) => call("extensions.syncState", { profile }) as Promise<T>;
export const applyExtensionsSync = (profile: string, args: Record<string, unknown>) => call("extensions.syncApply", { ...args, profile });

export const chooseExtensionFolder = () => call("extensions.chooseFolder");

export function permissionWarnings(pkg: Pick<ExtensionPackage, "permissions" | "hostPermissions">): string[] {
  const warnings: string[] = [];
  const perms = new Set(pkg.permissions);
  const hosts = pkg.hostPermissions.filter((h) => !/^(chrome|chrome-extension|about|data):/.test(h));
  const allHosts = hosts.some((h) => h === "<all_urls>" || /^(\*|https?|wss?):\/\/\*\//.test(h)) || perms.has("debugger");
  if (allHosts || perms.has("proxy") || perms.has("pageCapture") || perms.has("debugger")) {
    warnings.push("Read and change all your data on all websites");
  } else if (hosts.length) {
    const names = [...new Set(hosts.map(hostLabel).filter(Boolean))] as string[];
    if (names.length === 1) warnings.push(`Read and change your data on ${names[0]}`);
    else if (names.length === 2) warnings.push(`Read and change your data on ${names[0]} and ${names[1]}`);
    else if (names.length === 3) warnings.push(`Read and change your data on ${names[0]}, ${names[1]}, and ${names[2]}`);
    else if (names.length > 3) warnings.push(`Read and change your data on a number of websites`);
  }
  const clipboard = perms.has("clipboardRead") && perms.has("clipboardWrite");
  if (clipboard) warnings.push("Read and modify data you copy and paste");
  for (const [permission, message] of PERMISSION_WARNINGS) {
    if (clipboard && permission.startsWith("clipboard")) continue;
    if (perms.has(permission)) warnings.push(message);
  }
  if (perms.has("declarativeNetRequest") && !allHosts && !perms.has("declarativeNetRequestWithHostAccess"))
    warnings.push("Block content on any page");
  const browsing = perms.has("history") ? "Read and change your browsing history on all your signed-in devices" : null;
  if (!browsing && (perms.has("tabs") || perms.has("webNavigation")) && !allHosts) warnings.push("Read your browsing history");
  if (browsing) warnings.push(browsing);
  return [...new Set(warnings)];
}

function hostLabel(pattern: string): string | null {
  const m = /^[^:]+:\/\/(\*\.)?([^/]+)/.exec(pattern);
  if (!m) return null;
  return m[1] ? `all ${m[2]} sites` : m[2]!;
}

const PERMISSION_WARNINGS: [string, string][] = [
  ["bookmarks", "Read and change your bookmarks"],
  ["clipboardRead", "Read data you copy and paste"],
  ["clipboardWrite", "Modify data you copy and paste"],
  ["contentSettings", "Change your settings that control websites' access to features such as cookies, JavaScript, plugins, geolocation, microphone, camera etc."],
  ["desktopCapture", "Capture content of your screen"],
  ["downloads", "Manage your downloads"],
  ["downloads.open", "Open downloaded files"],
  ["geolocation", "Detect your physical location"],
  ["management", "Manage your apps, extensions, and themes"],
  ["nativeMessaging", "Communicate with cooperating native applications"],
  ["notifications", "Display notifications"],
  ["privacy", "Change your privacy-related settings"],
  ["readingList", "Read and change entries in the reading list"],
  ["sessions", "Read your browsing history on all your signed-in devices"],
  ["system.storage", "Identify and eject storage devices"],
  ["tabCapture", "Capture content of your screen"],
  ["tabGroups", "View and manage your tab groups"],
  ["topSites", "Read a list of your most frequently visited websites"],
  ["ttsEngine", "Read all text spoken using synthesized speech"],
  ["webAuthenticationProxy", "Read and change all your data on all websites"],
];
