import { sync, type ConnectResult, type PhraseCheck, type SyncedDevice } from "../../platform/sync";
import { choiceAfterMatchToggle, type ProfileLook } from "../../lib/profileLook";
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
import { isPinnedOnMac, pinsOnTheirWay } from "./spaces";
import { noteLocalChange, notePinSent, selectedProfile, selectedProfileId, startSyncSources, syncData, useSync } from "./store";
import { copy } from "../../lib/platformCopy";
import { countUsage } from "../telemetry/telemetry";
import {
  CONNECTED_TOAST,
  couldNotSendToast,
  pinAnnouncement,
  type PinOutcome,
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

export async function applyInbox(): Promise<number> {
  if (applying) {
    again = true;
    return 0;
  }
  applying = true;
  let total = 0;
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
      total += opened.length;
      if (opened.length) announce(opened);
    } while (again);
  } finally {
    applying = false;
  }
  return total;
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

export function matchMyMac(on: boolean, look: ProfileLook) {
  setPreference("colorChoice", choiceAfterMatchToggle(on, look, "plum") as ColorChoice | null);
}

export function sendTargetsFor(tab: BrowserTab | null): SyncedDevice[] {
  if (!tab || tab.isPrivate || !syncData().status.isEnabled || !isSyncableUrl(tab.url)) return [];
  return sendReceivers(syncData().view, tab.profileSyncId ?? selectedProfileId());
}

export async function sendTab(tab: BrowserTab, device: SyncedDevice) {
  if (!isSyncableUrl(tab.url)) return;
  const sent = await settled(() => sync.send({ url: tab.url, title: tab.title, deviceId: device.id, profileSyncId: tab.profileSyncId, fromPrivateTab: tab.isPrivate }), false);
  if (sent && !tab.isPrivate) countUsage("tabs_sent");
  showToast(sent ? sentToast(device.name) : couldNotSendToast(device.name), sent ? "sent" : "warning");
}

export const isTabPinned = (tab: BrowserTab | null) => Boolean(tab && syncData().status.isEnabled && isPinnedOnMac(selectedProfile(), tab.url, pinsOnTheirWay(syncData().view, syncData().pinsOnTheirWay)));

export async function pinToMac(tab: BrowserTab, onSetup: () => void, showInTitle: ((text: string) => void) | null = null) {
  if (tab.isPrivate || !isSyncableUrl(tab.url)) return;
  if (!syncData().status.isEnabled) {
    showToast(SYNC_TO_PIN_TOAST, "laptop", undefined, onSetup);
    return;
  }
  const announce = (outcome: PinOutcome) => {
    const said = pinAnnouncement(outcome, showInTitle !== null, copy());
    if (said.where === "title") showInTitle?.(said.text);
    else showToast(said.text, said.icon);
  };
  if (isTabPinned(tab)) {
    announce("alreadyPinned");
    return;
  }
  const pinned = await settled(() => sync.pinToMac({ url: tab.url, title: tab.title, profileSyncId: tab.profileSyncId }), false);
  if (pinned) {
    notePinSent(tab.profileSyncId ?? selectedProfileId(), tab.url);
    countUsage("pins_to_mac");
  }
  announce(pinned ? "pinned" : "failed");
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
