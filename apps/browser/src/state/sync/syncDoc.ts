import type { ScopeState } from "../../platform/sync";
import type { Profile } from "../browser/types";
import { unchanged, type Migrations } from "../../lib/savedDocument";

type SyncTypeSpec = { title: string; description: string; profileData?: true };

const SYNC_TYPES = {
  bookmarks: { title: "Bookmarks", description: "Each synced profile’s bookmarks bar and other bookmarks.", profileData: true },
  history: { title: "History", description: "The last 90 days.", profileData: true },
  tabs: { title: "Open Tabs", description: "Your other devices’ tabs show in the tab overflow menu." },
  pinned: { title: "Pinned Tabs and Groups", description: "Pinned tabs and pinned tab groups." },
  passwords: { title: "Passwords", description: "Saved passwords. Turning sync off never removes them from this Mac.", profileData: true },
  extensions: {
    title: "Extensions",
    description: "Extensions from the Chrome Web Store, whether they’re on, and whether they’re pinned.",
    profileData: true,
  },
  settings: { title: "Settings", description: "Search engine, appearance, tab and keyboard settings." },
} as const satisfies Record<string, SyncTypeSpec>;

export type DataType = keyof typeof SYNC_TYPES;

const SPECS: Readonly<Record<DataType, SyncTypeSpec>> = SYNC_TYPES;
const TYPE_IDS = Object.keys(SYNC_TYPES) as DataType[];

export const DATA_TYPES = TYPE_IDS.map((id) => ({ id, title: SPECS[id].title, description: SPECS[id].description }));

export const typeSyncedFor = (types: Record<DataType, boolean>, type: DataType, ownsData: boolean) =>
  types[type] && (ownsData || !SPECS[type].profileData);

export type ProfileLink = {
  syncId: string;
  enabled: boolean;
  retire?: boolean;
  themeAdopting?: true;
};

export type SyncDoc = {
  v: 1;
  enabled: boolean;
  folder: string | null;
  deviceId: string | null;
  clock: string | null;
  types: Record<DataType, boolean>;
  profiles: Record<string, ProfileLink>;
  scopes: Record<string, ScopeState>;
  lastSyncedAt: number | null;
  setupAt: number | null;
  joining: boolean;
  seqs?: Record<string, number>;
};

export const DOC = "sync.json";
export const DOC_VERSION = 1;
export const DOC_MIGRATIONS: Migrations = { 0: unchanged };
export const STATE = "sync-state.nns";
export const JOURNAL = "sync-journal.nns";
export const APP_SCOPE = "app";

export const defaultTypes = (): Record<DataType, boolean> => Object.fromEntries(TYPE_IDS.map((id) => [id, true])) as Record<DataType, boolean>;

export const emptyDoc = (): SyncDoc => ({
  v: 1,
  enabled: false,
  folder: null,
  deviceId: null,
  clock: null,
  types: defaultTypes(),
  profiles: {},
  scopes: {},
  lastSyncedAt: null,
  setupAt: null,
  joining: false,
});

export type SyncStatus = "off" | "starting" | "updating" | "updated" | "stalled" | "offline" | "locked" | "reset" | "unavailable";

export type SyncedDevice = { id: string; name: string; lastSeen: number | null; current: boolean };
export type RemoteTabs = { deviceId: string; name: string; tabs: { url: string; title: string }[] };
export type RemoteProfile = { syncId: string; name: string; color: Profile["color"]; icon: string | null; sharesWith?: { name: string; added: boolean }; waiting?: true };

export type SyncUi = {
  status: SyncStatus;
  enabled: boolean;
  joining: boolean;
  folder: string | null;
  types: Record<DataType, boolean>;
  profiles: Record<string, ProfileLink>;
  lastSyncedAt: number | null;
  error: string | null;
  pending: number;
  devices: SyncedDevice[];
  remoteTabs: Record<string, RemoteTabs[]>;
  remoteProfiles: RemoteProfile[];
};
