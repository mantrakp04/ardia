import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, plural } from "../browser/model";
import { switchToTab } from "../browser/actions";
import { showToast } from "../app/toasts";
import { isQuitting } from "../app/quit";
import { flushPersistence } from "../session/persist";
import { newBookmarkId as newUuid } from "../bookmarks/bookmarks";
import { deviceKindOf, deviceLabel, deviceRecords, deviceSymbol, offersTabs } from "./devices";
import { SEND, profileScope, type DeviceRecord, type SendRecord } from "./records";
import { sendableUrl, type ReceivedSend, type SendLedger } from "./sentTabsAdapter";
import { APP_SCOPE, type ReceivedTab, type SendTarget, type SyncDoc } from "./syncDoc";

export function sendLedger(doc: SyncDoc, scope: string): SendLedger {
  const sends = (doc.sends ??= {});
  return (sends[scope] ??= { outgoing: {}, received: {} });
}

export function sendTargetsIn(doc: SyncDoc, profileId: string): SendTarget[] {
  const link = doc.profiles[profileId];
  const app = doc.scopes[APP_SCOPE];
  const scope = link ? doc.scopes[profileScope(link.syncId)] : undefined;
  if (!doc.enabled || !doc.deviceId || !link?.enabled || link.retire || !app || !scope) return [];
  const now = Date.now();
  const seenAt = (id: string) => Math.max(...Object.values(doc.scopes).map((s) => s.seen[id] ?? -Infinity));
  return [...deviceRecords(app)]
    .filter(([id, record]) => id !== doc.deviceId && offersTabs(record, seenAt(id), now) && (deviceKindOf(record) === "phone" || id in scope.seen))
    .sort(([a], [b]) => (scope.seen[b] ?? app.seen[b] ?? 0) - (scope.seen[a] ?? app.seen[a] ?? 0))
    .map(([id, record]) => ({ id, name: record.n || "Unknown Device", kind: deviceKindOf(record) }));
}

export function queueSend(doc: SyncDoc, tabId: string, deviceId: string): boolean {
  const tab = useBrowser.getState().tabs[tabId];
  const link = tab ? doc.profiles[tab.profileId] : undefined;
  if (!tab || !link || !doc.deviceId || !sendableUrl(tab.url) || !sendTargetsIn(doc, tab.profileId).some((d) => d.id === deviceId)) return false;
  const send: SendRecord = { u: tab.url, t: tab.customTitle || tab.title || "", to: deviceId, from: doc.deviceId, at: Date.now() };
  sendLedger(doc, profileScope(link.syncId)).outgoing[`${SEND}${newUuid()}`] = send;
  return true;
}

const receivedListeners = new Set<(tabs: ReceivedTab[]) => void>();

export function onTabsReceived(listener: (tabs: ReceivedTab[]) => void): () => void {
  receivedListeners.add(listener);
  return () => receivedListeners.delete(listener);
}

function frontWindowShowing(s: BrowserState, profileId: string): string | undefined {
  return [...new Set([...s.ui.focusOrder, ...s.windowOrder])].find((id) => {
    const w = s.windows[id];
    return w?.kind === "main" && w.profileId === profileId;
  });
}

export function deliverSentTabs(doc: SyncDoc, profileId: string, arrived: ReceivedSend[]): boolean {
  if (isQuitting() || !useBrowser.getState().profiles[profileId]) return false;
  const app = doc.scopes[APP_SCOPE];
  const devices = app ? deviceRecords(app) : new Map<string, DeviceRecord>();
  const opened: ReceivedTab[] = [];
  for (const { send } of arrived) {
    const s = useBrowser.getState();
    const front = frontWindowShowing(s, profileId);
    const windowId = front ?? s.createWindow({ profileId, url: send.u, background: true });
    const tabId = front ? s.newTab(front, { url: send.u, background: true, profileId }) : activeTabId(useBrowser.getState(), windowId);
    const sender = devices.get(send.from);
    if (tabId) opened.push({ windowId, tabId, send, from: { name: sender?.n || "Unknown Device", kind: deviceKindOf(sender) } });
  }
  flushPersistence();
  showReceivedTabs(opened);
  for (const listener of receivedListeners) {
    try {
      listener(opened);
    } catch (error) {
      console.warn("[sync] a received-tab listener failed", error);
    }
  }
  return true;
}

const hostOf = (url: string) => /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url)?.[1] ?? url;

function showReceivedTabs(received: ReceivedTab[]) {
  const byWindow = new Map<string, ReceivedTab[]>();
  for (const r of received) byWindow.set(r.windowId, [...(byWindow.get(r.windowId) ?? []), r]);
  for (const [windowId, tabs] of byWindow) {
    const last = tabs[tabs.length - 1]!;
    const labels = new Set(tabs.map((r) => deviceLabel(r.from.kind, r.from.name)));
    const from = labels.size === 1 ? [...labels][0]! : "Your Devices";
    const title = tabs.length === 1 ? `Tab from ${from}` : `${plural(tabs.length, "Tab")} from ${from}`;
    const message = tabs.length === 1 ? last.send.t || hostOf(last.send.u) : undefined;
    const icon = labels.size === 1 ? deviceSymbol(last.from.kind, last.from.name) : "macbook.and.iphone";
    showToast(windowId, title, message, { icon, action: { title: "Show", run: () => switchToTab(last.tabId) } });
  }
}
