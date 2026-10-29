import type { ExtensionSearchEngine } from "@ardia/core";
import { call } from "./engine/call";

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
  userScriptsAvailable?: boolean;
  userScripts?: boolean;
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

export type TabsRequest =
  | { action: "adopt"; adoptId: string; url: string; profile: string }
  | { action: "adoptInto"; chromeWindow: string; adoptId: string; url: string; profile: string; active: boolean; focused: boolean }
  | { action: "moveInto"; chromeWindow: string; tabId: string; focused: boolean }
  | { action: "closeWindow"; chromeWindow: string };

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

export type ChromeSearchEngine = {
  name: string;
  keyword: string;
  url: string;
  suggestionsUrl: string;
  default: boolean;
  isOmniboxExtension: boolean;
  extension?: { id: string; name: string };
};

const withoutPlaceholders = (url: string) => url.replace(/\{[^{}%]*\}/g, "");

export async function extensionSearchEngines(profile: string): Promise<ExtensionSearchEngine[]> {
  const { list } = await call("search.engines", { profile });
  const engines: ExtensionSearchEngine[] = [];
  for (const e of list.engines) {
    const extension = e.extension;
    if (!extension || e.isOmniboxExtension || !e.url.includes("%s") || engines.some((o) => o.extensionId === extension.id)) continue;
    engines.push({
      profile,
      extensionId: extension.id,
      extensionName: extension.name,
      name: e.name || extension.name,
      keyword: e.keyword,
      url: withoutPlaceholders(e.url),
      suggestUrl: e.suggestionsUrl.includes("%s") ? withoutPlaceholders(e.suggestionsUrl) : undefined,
      isDefault: e.default,
    });
  }
  return engines;
}

export type ExtensionActionChange = { profile: string; id: string; kind: "action" | "sidePanel" | "registry" };

export type ExtensionSyncIntent = { id: string; kind: "installed" | "uninstalled" };

export type SyncedExtension =
  | { id: string; syncable: false }
  | {
      id: string;
      syncable: true;
      version: string;
      approved: boolean;
      fingerprint: string;
      enabled: boolean;
      userDisabled: boolean;
      incognito: boolean;
      pinned: boolean;
    };

export type ExtensionsSyncState = {
  ready: boolean;
  extensions: SyncedExtension[];
  pending: string[];
  settling: string[];
  queued: string[];
  intents: ExtensionSyncIntent[];
};

export type ExtensionsSyncApply = {
  id: string;
  record: { on: boolean; inc: boolean; pin: boolean } | { removed: true };
  approval?: { v: string; fps: string[] };
};

export type ExtensionsSyncApplied = {
  state: "invalid" | "kept" | "absent" | "cancelled" | "blocked" | "pending" | "refused" | "updating" | "installed";
};

export type SidePanelRequest = { tabId: string | null; extensionId: string; open: boolean };

export type ActionPopupRequest = { tabId: string | null; extensionId: string };
