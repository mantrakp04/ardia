import { requireNativeModule } from "expo-modules-core";
import type { Subscription } from "./pageTypes";

export type SyncPhase = "off" | "starting" | "updating" | "updated" | "stalled" | "offline" | "needsFolderAccess" | "locked" | "reset";

export type SyncAttention = "none" | "folder" | "phrase" | "reset" | "stalled";

export type SyncStatus = {
  phase: SyncPhase;
  statusText: string;
  stalledMessage: string | null;
  attention: SyncAttention;
  isEnabled: boolean;
  isSyncing: boolean;
  isDemo: boolean;
  pendingDownloads: number;
  lastSynced: number | null;
  folderName: string | null;
  deviceName: string;
  selectedProfileId: string | null;
  showsResetNotice: boolean;
};

export type PhraseCheck = { wordCount: number; counterText: string; isTooLong: boolean; problem: string | null; isValid: boolean };

export type ConnectResult =
  | { result: "connected" }
  | { result: "invalidPhrase"; problem: string }
  | { result: "mismatch" }
  | { result: "noSyncData" }
  | { result: "folderUnavailable" }
  | { result: "keyStoreFailed" }
  | { result: "busy" }
  | { result: "cancelled" };

export type SyncedDevice = { id: string; name: string; kind: "mac" | "phone" | string; lastSeen: number | null; isCurrent: boolean; canReceiveTabs: boolean };

export type RemoteTab = { url: string; title: string };

export type DeviceTabs = { deviceId: string; deviceName: string; kind: string; tabs: RemoteTab[] };

export type PinnedTab = { key: string; title: string; url: string; icon: string | null };

export type PinnedTile = PinnedTab & { folder: PinnedTab[] | null };

export type PinnedGroup = { key: string; name: string; icon: string | null; color: string | null; items: PinnedSection[] };

export type PinnedSection = { tab: PinnedTab | null; group: PinnedGroup | null };

export type BookmarkItem = { key: string; title: string; url: string | null; added: number; root: string | null; children: BookmarkItem[] | null };

export type SyncedHistoryItem = { url: string; title: string; visits: number; lastVisit: number };

export type SyncedProfile = {
  syncId: string;
  name: string;
  color: string | null;
  icon: string | null;
  isDefault: boolean;
  theme: { colors: string[]; darkColors: string[] | null } | null;
  deviceTabs: DeviceTabs[];
  pinned: { tiles: PinnedTile[]; sections: PinnedSection[] };
  bookmarks: BookmarkItem[];
  history: SyncedHistoryItem[];
  sendTargets: string[] | null;
};

export type SyncedSearch = { engineId: string; customURL: string | null; customEngines: { id: string; name: string; keyword: string; url: string }[] };

export type SyncedView = {
  devices: SyncedDevice[];
  profiles: SyncedProfile[];
  search: SyncedSearch | null;
  syncedAt: number | null;
  selectedProfileId: string | null;
  receivers: SyncedDevice[];
};

export type ReceivedTab = { key: string; url: string; title: string; fromDevice: string; fromDeviceId: string; sentAt: number; profileSyncId: string };

export type HistoryRemoval = { profileSyncId: string | null; urls: string[]; includesUnassigned: boolean };

export type PhoneInbox = { id: number; received: ReceivedTab[]; removals: HistoryRemoval[] };

export type SyncEvent =
  | { name: "sync.status"; status: SyncStatus }
  | { name: "sync.view"; view: SyncedView }
  | { name: "sync.incoming"; tabs: ReceivedTab[] }
  | { name: "sync.inbox"; count: number };

type SyncNative = {
  addListener(eventName: "onSyncEvent", listener: (event: SyncEvent) => void): Subscription;
  status(): Promise<SyncStatus>;
  view(): Promise<SyncedView>;
  incoming(): Promise<ReceivedTab[]>;
  check(phrase: string): PhraseCheck;
  connect(phrase: string): Promise<ConnectResult>;
  changeFolder(): Promise<ConnectResult>;
  stopSyncing(): Promise<void>;
  acknowledgeReset(): Promise<void>;
  syncNow(): Promise<void>;
  setDeviceName(name: string): Promise<void>;
  selectProfile(profileSyncId: string | null): Promise<void>;
  receivers(profileSyncId: string | null): Promise<SyncedDevice[]>;
  send(url: string, title: string, deviceId: string, profileSyncId: string | null, fromPrivateTab: boolean): Promise<boolean>;
  pinToMac(url: string, title: string, profileSyncId: string | null, fromPrivateTab: boolean): Promise<boolean>;
  clearIncoming(): Promise<void>;
  localDidChange(): void;
  inbox(): Promise<PhoneInbox[]>;
  inboxApplied(ids: number[]): Promise<void>;
};

let loaded: SyncNative | undefined;
const native = () => (loaded ??= requireNativeModule<SyncNative>("ArdiaSync"));

export const sync = {
  status: () => native().status(),
  view: () => native().view(),
  incoming: () => native().incoming(),
  check: (phrase: string) => native().check(phrase),
  connect: (phrase: string) => native().connect(phrase),
  changeFolder: () => native().changeFolder(),
  stopSyncing: () => native().stopSyncing(),
  acknowledgeReset: () => native().acknowledgeReset(),
  syncNow: () => native().syncNow(),
  setDeviceName: (name: string) => native().setDeviceName(name),
  selectProfile: (profileSyncId: string | null) => native().selectProfile(profileSyncId),
  receivers: (profileSyncId: string | null = null) => native().receivers(profileSyncId),
  send: (tab: { url: string; title: string; deviceId: string; profileSyncId?: string | null; fromPrivateTab?: boolean }) =>
    native().send(tab.url, tab.title, tab.deviceId, tab.profileSyncId ?? null, tab.fromPrivateTab ?? false),
  pinToMac: (tab: { url: string; title: string; profileSyncId?: string | null; fromPrivateTab?: boolean }) =>
    native().pinToMac(tab.url, tab.title, tab.profileSyncId ?? null, tab.fromPrivateTab ?? false),
  clearIncoming: () => native().clearIncoming(),
  localDidChange: () => native().localDidChange(),
  inbox: () => native().inbox(),
  inboxApplied: (ids: number[]) => native().inboxApplied(ids),
  addListener: (listener: (event: SyncEvent) => void): Subscription => native().addListener("onSyncEvent", listener),
};
