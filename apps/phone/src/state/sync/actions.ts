import { sync, type ConnectResult, type PhraseCheck, type SyncedDevice } from "../../platform/sync";
import { pasteText } from "../../platform/system";
import { openTab, showDeck, useBrowse } from "../browse/store";
import { history } from "../history/store";
import { useOnboarding } from "../onboarding/store";
import { settled } from "../pages/store";
import { applySearchEngine, feedSources } from "../search/store";
import type { ColorChoice } from "../settings/preferences";
import { setPreference } from "../settings/store";
import { historyCuts } from "../tabs/received";
import { currentTabs, openNewTab, receiveSentTabs, setIncognito, useTabs } from "../tabs/store";
import { isSyncableUrl, type BrowserTab } from "../tabs/tabModels";
import { findTab } from "../tabs/tabsState";
import { showToast, TOAST_LONG_DURATION_MS } from "../toasts/store";
import { isPinnedOnMac } from "./spaces";
import { noteLocalChange, selectedProfile, selectedProfileId, startSyncSources, syncData, useSync } from "./store";
import {
  CONNECTED_TOAST,
  COULD_NOT_PIN_TOAST,
  couldNotSendToast,
  PINNED_TOAST,
  receivedSender,
  receivedToast,
  sendReceivers,
  sentToast,
  SYNC_TO_PIN_TOAST,
} from "./syncRules";

const quietly = (call: () => Promise<unknown>) => void settled(call, undefined);

let applying = false;
let again = false;
let held: BrowserTab[] = [];

function announce(opened: BrowserTab[]) {
  if (useOnboarding.getState().showing) {
    held = [...held, ...opened];
    return;
  }
  const ids = opened.map((tab) => tab.id);
  const sender = receivedSender(opened.map((tab) => tab.receivedFromDevice));
  showToast(receivedToast(sender, ids.length), "laptop", TOAST_LONG_DURATION_MS, () => {
    if (ids.length === 1 && findTab(currentTabs(), ids[0]!)) openTab(ids[0]!);
    else void showDeck();
  });
  quietly(() => sync.clearIncoming());
}

export async function applyInbox() {
  if (applying) {
    again = true;
    return;
  }
  applying = true;
  try {
    do {
      again = false;
      const entries = await settled(() => sync.inbox(), []);
      if (!entries.length) continue;
      const opened = receiveSentTabs(entries.flatMap((entry) => entry.received));
      for (const removal of entries.flatMap((entry) => entry.removals)) {
        for (const cut of historyCuts(removal)) history().removeVisits(cut.urls, cut.profileSyncId);
      }
      await settled(() => sync.inboxApplied(entries.map((entry) => entry.id)), undefined);
      feedSources();
      if (opened.length) announce(opened);
    } while (again);
  } finally {
    applying = false;
  }
}

export function startSync() {
  startSyncSources(() => void applyInbox());
  let listing = useTabs.getState().listing;
  useTabs.subscribe((tabs) => {
    if (tabs.listing === listing) return;
    listing = tabs.listing;
    noteLocalChange();
  });
  let enabled = syncData().status.isEnabled;
  let profile = selectedProfileId();
  let view = syncData().view;
  useSync.subscribe((state) => {
    const nowProfile = selectedProfileId();
    if (state.status.isEnabled === enabled && nowProfile === profile && state.view === view) return;
    enabled = state.status.isEnabled;
    profile = nowProfile;
    view = state.view;
    applySearchEngine();
    feedSources();
  });
  useOnboarding.subscribe((state) => {
    if (state.showing || !held.length) return;
    const waiting = held.filter((tab) => findTab(currentTabs(), tab.id));
    held = [];
    if (waiting.length) announce(waiting);
  });
}

const OFF_CHECK: PhraseCheck = { wordCount: 0, counterText: "0/24 words", isTooLong: false, problem: null, isValid: false };

export function checkPhrase(phrase: string): PhraseCheck {
  try {
    return sync.check(phrase);
  } catch {
    const count = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;
    return { ...OFF_CHECK, wordCount: count, counterText: count > 24 ? "too many words" : `${count}/24 words`, isTooLong: count > 24 };
  }
}

export async function connectSync(phrase: string): Promise<ConnectResult> {
  const result = await settled(() => sync.connect(phrase), { result: "folderUnavailable" } as ConnectResult);
  if (result.result === "connected") showToast(CONNECTED_TOAST, "checkmark");
  return result;
}

export const changeSyncFolder = (): Promise<ConnectResult> => settled(() => sync.changeFolder(), { result: "folderUnavailable" } as ConnectResult);

export const pastedText = () => settled(() => pasteText(), "");

export const stopSyncing = () => settled(() => sync.stopSyncing(), undefined);

export const acknowledgeSyncReset = () => settled(() => sync.acknowledgeReset(), undefined);

export const syncNow = () => settled(() => sync.syncNow(), undefined);

export const setDeviceName = (name: string) => quietly(() => sync.setDeviceName(name));

export function selectProfile(profileSyncId: string) {
  quietly(() => sync.selectProfile(profileSyncId));
}

export function matchMyMac(on: boolean, current: ColorChoice) {
  setPreference("colorChoice", on ? null : current);
}

export function sendTargetsFor(tab: BrowserTab | null): SyncedDevice[] {
  if (!tab || tab.isPrivate || !syncData().status.isEnabled || !isSyncableUrl(tab.url)) return [];
  const { view, status } = syncData();
  return sendReceivers(view, tab.profileSyncId ?? selectedProfileId() ?? status.selectedProfileId);
}

export async function sendTab(tab: BrowserTab, device: SyncedDevice) {
  if (!isSyncableUrl(tab.url)) return;
  const sent = await settled(() => sync.send({ url: tab.url, title: tab.title, deviceId: device.id, profileSyncId: tab.profileSyncId, fromPrivateTab: tab.isPrivate }), false);
  showToast(sent ? sentToast(device.name) : couldNotSendToast(device.name), sent ? "sent" : "warning");
}

export const isTabPinned = (tab: BrowserTab | null) => Boolean(tab && syncData().status.isEnabled && isPinnedOnMac(selectedProfile(), tab.url));

export async function pinToMac(tab: BrowserTab, onSetup: () => void) {
  if (tab.isPrivate || !isSyncableUrl(tab.url)) return;
  if (!syncData().status.isEnabled) {
    showToast(SYNC_TO_PIN_TOAST, "laptop", undefined, onSetup);
    return;
  }
  if (isTabPinned(tab)) {
    showToast(PINNED_TOAST, "star");
    return;
  }
  const pinned = await settled(() => sync.pinToMac({ url: tab.url, title: tab.title, profileSyncId: tab.profileSyncId }), false);
  showToast(pinned ? PINNED_TOAST : COULD_NOT_PIN_TOAST, pinned ? "star" : "warning");
}

export function openRemote(url: string, title: string, profileSyncId: string | null) {
  if (!/^https?:\/\//i.test(url)) return;
  useBrowse.setState({ sheet: null });
  setIncognito(false);
  if (profileSyncId && syncData().status.isEnabled && profileSyncId !== selectedProfileId()) selectProfile(profileSyncId);
  const profile = profileSyncId ?? selectedProfileId();
  const existing = currentTabs().open.find((tab) => tab.url === url && tab.profileSyncId === profile);
  if (existing) {
    openTab(existing.id);
    return;
  }
  const tab = openNewTab({ url, title, origin: "sync", profileSyncId: profile, isPrivate: false });
  openTab(tab.id);
}
