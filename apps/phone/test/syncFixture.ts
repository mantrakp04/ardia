import type { SyncedProfile, SyncedView, SyncStatus } from "../src/platform/sync.ts";

export const NOW = 1_800_000_000_000;

export function status(patch: Partial<SyncStatus> = {}): SyncStatus {
  return {
    phase: "updated",
    statusText: "Updated just now",
    stalledMessage: null,
    attention: "none",
    isEnabled: true,
    isSyncing: false,
    isDemo: false,
    pendingDownloads: 0,
    lastSynced: NOW - 5_000,
    folderName: "Ardia Sync",
    deviceName: "POCO M3 Pro",
    selectedProfileId: "work",
    showsResetNotice: false,
    ...patch,
  };
}

const personal: SyncedProfile = {
  syncId: "personal",
  name: "Personal",
  color: "#4691C3",
  icon: null,
  isDefault: true,
  theme: null,
  deviceTabs: [
    {
      deviceId: "studio",
      deviceName: "Mac Studio",
      kind: "mac",
      tabs: Array.from({ length: 12 }, (_, i) => ({ url: `https://news.example/${i}`, title: `Story ${i}` })),
    },
  ],
  pinned: { tiles: [], sections: [] },
  bookmarks: [],
  history: [{ url: "https://lisbon.example/", title: "Lisbon", visits: 3, lastVisit: NOW - 60_000 }],
  sendTargets: ["studio"],
};

const work: SyncedProfile = {
  syncId: "work",
  name: "Work",
  color: null,
  icon: "briefcase",
  isDefault: false,
  theme: { colors: ["#3EB489", "#2A8A66"], darkColors: null },
  deviceTabs: [
    { deviceId: "air", deviceName: "Shivam’s MacBook Air", kind: "mac", tabs: [{ url: "https://linear.example/", title: "Linear" }] },
    { deviceId: "phone", deviceName: "POCO M3 Pro", kind: "phone", tabs: [{ url: "https://phone.example/", title: "Phone tab" }] },
  ],
  pinned: {
    tiles: [
      { key: "t1", title: "Mail", url: "https://mail.example/", icon: null, folder: null },
      { key: "t2", title: "Docs", url: "https://docs.example/", icon: null, folder: [{ key: "t2a", title: "Spec", url: "https://docs.example/spec", icon: null }] },
    ],
    sections: [
      { tab: { key: "p1", title: "", url: "https://www.github.com/ardia", icon: null }, group: null },
      {
        tab: null,
        group: { key: "g1", name: "Launch", icon: null, color: "green", items: [{ tab: { key: "p2", title: "Plan", url: "https://plan.example/", icon: null }, group: null }] },
      },
    ],
  },
  bookmarks: [
    { key: "b1", title: "Reading", url: null, added: 1, root: "bar", children: [{ key: "b2", title: "Essay", url: "https://essay.example/", added: 2, root: null, children: null }] },
  ],
  history: [{ url: "https://linear.example/", title: "Linear", visits: 9, lastVisit: NOW - 120_000 }],
  sendTargets: ["air", "phone"],
};

export function view(patch: Partial<SyncedView> = {}): SyncedView {
  return {
    devices: [
      { id: "phone", name: "POCO M3 Pro", kind: "phone", lastSeen: NOW, isCurrent: true, canReceiveTabs: true },
      { id: "studio", name: "Mac Studio", kind: "mac", lastSeen: NOW - 3 * 3_600_000, isCurrent: false, canReceiveTabs: true },
      { id: "air", name: "Shivam’s MacBook Air", kind: "mac", lastSeen: NOW - 30_000, isCurrent: false, canReceiveTabs: true },
    ],
    profiles: [personal, work],
    search: { engineId: "duckduckgo", customURL: null, customEngines: [] },
    syncedAt: NOW - 5_000,
    selectedProfileId: "work",
    receivers: [],
    ...patch,
  };
}
