import type { AddressInput, SavedAddress, SavedCard } from "../autofill";
import type { EngineBookmark, BookmarkOp } from "../bookmarks";
import type { CastDialog, CastRoute, DeviceChooser } from "../media";
import type { ContentBlockerState, ContentBlockerStats } from "../contentBlocker";
import type {
  ActionPopupRequest, ActionState, ChromeSearchEngine, ExtensionActionChange, ExtensionInstallPrompt, ExtensionPackage, ExtensionsChange, ExtensionsSyncApplied, ExtensionsSyncApply,
  ExtensionsSyncState, ExtensionSyncIntent, InstalledExtension, SidePanelRequest, TabsRequest,
} from "../extensions";
import type { HistoryChangedBatch, HistoryWireRow } from "../history";
import type { FaviconImage } from "../favicons";
import type { Download, DownloadSettings } from "../downloads";
import type {
  BatterySaverMode, BatterySaverState, CliControlStatus, EngineComponent, EngineInfo, EngineTask, MemorySaverRequest, MemorySaverState, SystemState,
} from "../engineDomain";
import type { ExternalAppAllowance, PermissionRequest, PermissionResult } from "../permissions";
import type { BrowsingDataType } from "../profiles";
import type { ChromeWindowState } from "../windows";
import type { PasswordExportStatus, SavedPassword } from "../passwords";
import type { ClearSiteDataResult, SiteSettings, SiteSettingType, SiteSettingValue } from "../siteSettings";
import type { LinkRoute, TabStripCommand, TabStripTransaction } from "../tabs";
import type { PageCookie, PageEngine, PasskeyAccess } from "../webkit";
import type { DisplayMediaSource } from "../pageTypes";

type Profile = { profile: string };
type Done = Record<string, never> | null;
type VideoUpscalingState = { enabled: boolean; lowPower: boolean; thermalPressure: boolean; appActive: boolean; tabs: { tabId: number; allowed: boolean }[] };

export type EngineCalls = {
  "engine.info": [{}, EngineInfo];
  "engine.components": [{}, EngineComponent[]];
  "engine.tasks": [{}, EngineTask[]];
  "engine.beginTracing": [{}, boolean];
  "engine.endTracing": [{ keep: boolean }, string | null];
  "engine.isTracing": [{}, boolean];
  "engine.systemState": [{}, SystemState];
  "engine.batterySaver": [{ mode: BatterySaverMode }, BatterySaverState];
  "engine.memorySaver": [MemorySaverRequest, MemorySaverState];
  "engine.validateKeepActiveSite": [{ site: string }, { valid: boolean }];
  "engine.trimMemory": [{}, { ok: boolean }];
  "engine.openTaskManager": [{}, { ok: boolean }];
  "engine.cliControlStatus": [{}, CliControlStatus];
  "engine.setCliControl": [{ on: boolean }, CliControlStatus];
  "engine.setCliActiveTab": [{ tabId: string | null }, CliControlStatus];

  "tabs.routeLinkTabs": [{ urls: string[] }, LinkRoute];
  "tabs.stripCommand": [{ id: number; command: TabStripCommand }, null];
  "tabs.strips": [{}, TabStripTransaction];
  "tabs.lastTabPolicy": [{}, { closesWindow: boolean }];
  "tabs.devBrowserId": [{ tabId: string }, number];
  "tabs.devEvents": [{ tabId: string }, { name: string; payload: unknown }[]];
  "tabs.devWindowNumber": [{ tabId: string }, number];
  "tabs.devFocusPage": [{ tabId: string }, boolean];
  "tabs.devPagePhase": [{ tabId: string }, "waiting" | "creating" | "attached" | "closing" | null];
  "tabs.devClosePage": [{ tabId: string }, boolean];
  "tabs.devPictureInPicture": [{}, unknown[]];
  "tabs.devPictureInPictureAction": [{ action: string }, string];
  "tabs.devPostPeekMouseUp": [{ keys: string; tabId: string }, boolean];
  "tabs.devScrollZoom": [{ steps: Record<string, unknown>[]; tabId?: string }, number[]];

  "windows.list": [{}, ChromeWindowState[]];
  "windows.dev": [{ window: number; action: string }, string];

  "downloads.cancel": [{ id: string }, null];
  "downloads.pause": [{ id: string }, null];
  "downloads.resume": [{ id: string }, null];
  "downloads.keep": [{ id: string }, null];
  "downloads.settings": [Profile, DownloadSettings];
  "downloads.setSettings": [Profile & Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, DownloadSettings];

  "permissions.resolve": [{ id: string; result: PermissionResult; remember: boolean }, null];
  "permissions.resolveExternalApp": [{ id: string; open: boolean; remember: boolean }, null];
  "permissions.externalAppAllowances": [Profile, ExternalAppAllowance[]];
  "permissions.removeExternalAppAllowance": [Profile & { origin: string; scheme: string }, null];
  "permissions.devExternalLaunches": [{}, Record<string, unknown>[]];

  "profiles.release": [Profile, null];
  "profiles.deleteData": [Profile, { remaining: string[] }];
  "profiles.clearBrowsingData": [Profile & { types: BrowsingDataType[]; since: number | null }, null];

  "sites.settings": [Profile & { origin: string; engine: PageEngine }, SiteSettings];
  "sites.setSetting": [Profile & { origin: string; type: SiteSettingType; value: SiteSettingValue; engine: PageEngine }, null];
  "sites.origins": [Profile, string[]];
  "sites.reset": [Profile & { origin: string }, null];
  "sites.clearData": [Profile & { origin: string; engine: PageEngine }, ClearSiteDataResult];
  "sites.zoomLevels": [Profile, Record<string, number>];
  "sites.setZoom": [Profile & { host: string; zoom: number }, null];

  "passwords.list": [Profile, { passwords: SavedPassword[] }];
  "passwords.unlock": [Profile, { unlocked: boolean }];
  "passwords.reveal": [Profile & { origin: string; username: string }, { password: string | null }];
  "passwords.remove": [Profile & { origin: string; username: string }, { ok: true }];
  "passwords.neverSaveOrigins": [Profile, { origins: string[] }];
  "passwords.allowSaving": [Profile & { origin: string }, { ok: true }];
  "passwords.export": [Profile, { status: PasswordExportStatus; path?: string }];
  "passwords.autofillEnabled": [Profile, boolean];
  "passwords.setAutofillEnabled": [Profile & { enabled: boolean }, null];

  "autofill.settings": [Profile, { addresses: boolean; cards: boolean }];
  "autofill.setSettings": [Profile & { addresses?: boolean; cards?: boolean }, null];
  "autofill.addresses": [Profile, { addresses: SavedAddress[] }];
  "autofill.saveAddress": [Profile & { address: AddressInput }, { id: string }];
  "autofill.cards": [Profile, { cards: SavedCard[] }];
  "autofill.remove": [Profile & { id: string }, { ok: true }];
  "autofill.cardNumber": [Profile & { id: string }, { number?: string | null }];
  "autofill.showSuggestions": [{ tabId: string; passwords: boolean }, boolean];

  "extensions.list": [Profile, { extensions: InstalledExtension[] }];
  "extensions.inspectUnpacked": [{ path: string }, ExtensionPackage];
  "extensions.install": [Profile & { path: string }, { id: string }];
  "extensions.installCrx": [Profile & { path: string }, { id: string }];
  "extensions.setEnabled": [Profile & { id: string; enabled: boolean }, { ok: true }];
  "extensions.uninstall": [Profile & { id: string }, { ok: true }];
  "extensions.reload": [Profile & { id: string }, { ok: true }];
  "extensions.configure": [Profile & { id: string; options: Record<string, unknown> }, { ok: true }];
  "extensions.chooseFolder": [{}, string | null];
  "extensions.resolveInstallPrompt": [{ requestId: string; accepted: boolean }, null];
  "extensions.actionStates": [{ tabId: string; ids: string[] }, Record<string, ActionState>];
  "extensions.sidePanelUrl": [{ tabId: string; extensionId: string }, string | null];
  "extensions.watchActions": [Profile, Done];
  "extensions.syncState": [Profile, ExtensionsSyncState];
  "extensions.syncApply": [Profile & ExtensionsSyncApply, ExtensionsSyncApplied];

  "search.engines": [Profile, { list: { engines: ChromeSearchEngine[] } }];
  "search.setEngineName": [{ name: string }, null];

  "media.displayMediaSources": [{}, DisplayMediaSource[]];
  "media.selectDevice": [{ id: number; index: number }, null];
  "media.cancelDeviceChooser": [{ id: number }, null];
  "media.refreshDeviceChooser": [{ id: number }, null];
  "media.openBluetoothSettings": [{ id: number }, null];
  "media.devShowBluetoothChooser": [{ tabId: string; unauthorized: boolean }, boolean];
  "media.devChooserEvents": [{}, Record<string, unknown>[]];
  "media.showCastDialog": [{ tabId: string }, boolean];
  "media.startCasting": [{ id: number; sink: string; mode: number }, null];
  "media.stopCasting": [{ id: number; route: string }, null];
  "media.closeCastDialog": [{ id: number }, null];
  "media.watchCastRoutes": [Profile, null];
  "media.terminateCastRoute": [{ route: string }, null];
  "media.changeCaptureSource": [{ capturer: string; target: string }, boolean];
  "media.stopCapture": [{ tabId: string }, boolean];

  "contentBlocker.state": [{}, ContentBlockerState];
  "contentBlocker.setEnabled": [{ enabled: boolean }, null];
  "contentBlocker.setListEnabled": [{ id: string; enabled: boolean }, null];
  "contentBlocker.isAllowed": [{ host: string }, boolean];
  "contentBlocker.setAllowed": [{ host: string; allowed: boolean }, null];
  "contentBlocker.devFailNextMessage": [{}, null];
  "contentBlocker.devDelayNextLoad": [{ ms: number }, null];

  "history.query": [Profile & { maxUrls: number; maxVisits: number }, { entries: (HistoryWireRow & { v: number[] })[] }];
  "history.add": [Profile & { pages: { u: string; t: string; v: number[] }[]; toleranceMs: number }, { added: number }];
  "history.import": [Profile & { rows: { u: string; t: string; n: number; l: number }[] }, Done];
  "history.deleteUrls": [Profile & { urls: string[] }, Done];
  "history.watch": [Profile, Done];

  "bookmarks.tree": [Profile, { bar: EngineBookmark; other: EngineBookmark }];
  "bookmarks.apply": [Profile & { ops: BookmarkOp[] }, { applied: number; skipped: number; invalid: string[] }];
  "bookmarks.watch": [Profile, Done];
  "bookmarks.exportHtml": [Profile, string | null];

  "favicons.get": [Profile & { pages: string[]; icons: string[]; size: number }, { pages: Record<string, { png: string; icon: string }>; icons: Record<string, { png: string }> }];
  "favicons.set": [Profile & { page: string; icon: string; png: string }, { stored: boolean }];
  "favicons.fetch": [Profile & { url: string }, FaviconImage | null];

  "webView.setDisplayMediaPicker": [{ enabled: boolean }, null];
  "webView.setPeekModifier": [{ modifier: "alt" | "shift" | "off" }, null];
  "webView.setSplitLinkModifier": [{ modifier: "alt" | "altShift" }, null];
  "webView.setPeekOtherSiteTabs": [{ tabIds: string[] }, null];
  "webView.setSelectionPopover": [{ enabled: boolean }, null];
  "webView.setCommandScrollZoom": [{ enabled: boolean }, null];
  "webView.setAutoPictureInPicture": [{ enabled: boolean }, null];
  "webView.setVideoUpscaling": [{ enabled: boolean }, null];
  "webView.setVideoUpscalingTestConditions": [{ lowPower?: boolean; thermalPressure?: boolean }, null];
  "webView.videoUpscalingState": [{}, VideoUpscalingState | null];

  "webKit.removeDownloadStaging": [{ path: string }, boolean];
  "webKit.endPrivateSession": [{ session: string }, null];
  "webKit.cookieStoreKey": [Profile, string];
  "webKit.importCookies": [Profile & { storeKey: string; cookies: PageCookie[] }, number];
  "webKit.devStoreExists": [Profile, boolean];
  "webKit.devTouchStore": [Profile, boolean];
  "webKit.devHoldStore": [Profile, null];
  "webKit.devParkedTransfers": [{}, string[]];
  "webKit.passkeyAccess": [{}, PasskeyAccess];
  "webKit.requestPasskeyAccess": [{}, PasskeyAccess];
};

export type EngineEvents = {
  "engine.systemState": SystemState;
  "engine.cliControl": CliControlStatus;
  "tabs.strips": TabStripTransaction;
  "downloads.changed": Download;
  "permissions.requested": PermissionRequest;
  "permissions.dismissed": { id: string };
  "contentBlocker.changed": ContentBlockerStats;
  "extensions.changed": ExtensionsChange;
  "extensions.tabs": TabsRequest;
  "extensions.installPrompt": ExtensionInstallPrompt;
  "extensions.installFailed": { message: string; tabId: string | null };
  "extensions.sidePanel": SidePanelRequest;
  "extensions.actionPopup": ActionPopupRequest;
  "extensions.actionShortcut": ActionPopupRequest;
  "extensions.action": ExtensionActionChange;
  "extensions.sync": { profile: string } & ExtensionSyncIntent;
  "history.changed": HistoryChangedBatch;
  "bookmarks.changed": { profile: string };
  "media.deviceChooser": DeviceChooser;
  "media.castDialog": CastDialog;
  "media.castRoutes": { profile: string; routes: CastRoute[] };
};
