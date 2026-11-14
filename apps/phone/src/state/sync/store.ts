import { create } from "zustand";
import { sync, type SyncedView, type SyncEvent, type SyncStatus } from "../../platform/sync";

export type { PinnedTile, SyncedProfile } from "../../platform/sync";
import { settled } from "../pages/store";
import { setTabProfile } from "../tabs/store";
import { pinKey, pinsStillOnTheirWay } from "./spaces";
import { shownProfile } from "./syncRules";

export const notePinSent = (profileSyncId: string | null, url: string) =>
  useSync.setState((state) => ({ pinsOnTheirWay: [...state.pinsOnTheirWay, pinKey(profileSyncId, url)] }));

export const OFF_STATUS: SyncStatus = {
  phase: "off",
  statusText: "Off",
  stalledMessage: null,
  attention: "none",
  isEnabled: false,
  isSyncing: false,
  isDemo: false,
  pendingDownloads: 0,
  lastSynced: null,
  folderName: null,
  deviceName: "",
  selectedProfileId: null,
  showsResetNotice: false,
  inboxProblem: null,
};

export const EMPTY_VIEW: SyncedView = { devices: [], profiles: [], search: null, syncedAt: null, selectedProfileId: null, receivers: [] };

type SyncData = { available: boolean; status: SyncStatus; view: SyncedView; revision: number; pinsOnTheirWay: string[] };

export const useSync = create<SyncData>()(() => ({ available: false, status: OFF_STATUS, view: EMPTY_VIEW, revision: 0, pinsOnTheirWay: [] }));

export const syncData = () => useSync.getState();

const LOCAL_CHANGE_DELAY_MS = 1000;

let started = false;
let localTimer: ReturnType<typeof setTimeout> | null = null;
const inboxListeners = new Set<() => void>();

export function selectedProfileId(): string | null {
  const { status, view } = syncData();
  return shownProfile(view, status)?.syncId ?? null;
}

export const selectedProfile = () => {
  const { status, view } = syncData();
  return shownProfile(view, status);
};

function publish(patch: Partial<SyncData>) {
  useSync.setState((state) => ({ ...patch, revision: state.revision + 1 }));
  setTabProfile(selectedProfileId());
}

function onEvent(event: SyncEvent) {
  if (event.name === "sync.status") publish({ status: event.status });
  else if (event.name === "sync.view") publish({ view: event.view, pinsOnTheirWay: pinsStillOnTheirWay(syncData().pinsOnTheirWay, event.view) });
  else if (event.name === "sync.inbox" && event.count > 0) for (const listener of inboxListeners) listener();
}

export function startSyncSources(onInbox: () => void) {
  inboxListeners.add(onInbox);
  if (started) return;
  started = true;
  try {
    sync.addListener(onEvent);
  } catch {
    return;
  }
  useSync.setState({ available: true });
  void Promise.all([settled(() => sync.status(), null), settled(() => sync.view(), null)]).then(([status, view]) => {
    publish({ ...(status ? { status } : {}), ...(view ? { view } : {}) });
    onInbox();
  });
}

export function noteLocalChange() {
  if (!syncData().status.isEnabled) return;
  if (localTimer) clearTimeout(localTimer);
  localTimer = setTimeout(() => {
    localTimer = null;
    try {
      sync.localDidChange();
    } catch {
      return;
    }
  }, LOCAL_CHANGE_DELAY_MS);
}

export const setStatus = (status: SyncStatus) => publish({ status });
