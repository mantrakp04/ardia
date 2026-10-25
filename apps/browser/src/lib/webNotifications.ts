import type { WebNotification } from "@ardia/ardiacore";
import {
  confirm,
  notificationPermission,
  openNotificationSettings,
  postNotification,
  removeNotifications,
  requestNotificationPermission,
  type NotificationResponse,
} from "@ardia/shell";
import { useBrowser } from "../store/browser";
import { focus, switchToTab } from "./actions";
import { webviews } from "./webviews";

const shown = new Map<string, { tabId: string; engineId: string }>();

const macId = (tabId: string, n: WebNotification) => (n.tag ? `web:${n.origin}#${n.tag}` : `web:${n.origin}|${tabId}|${n.id}`);

const received = new Map<string, WebNotification>();
const RECEIVED_KEPT = 50;
if (__DEV__) (globalThis as { acWebNotifications?: unknown }).acWebNotifications = { received: () => [...received.values()] };

function noteReceived(tabId: string, n: WebNotification) {
  received.delete(macId(tabId, n));
  received.set(macId(tabId, n), n);
  for (const id of received.keys()) {
    if (received.size <= RECEIVED_KEPT) break;
    received.delete(id);
  }
}

export function showWebNotification(tabId: string, n: WebNotification) {
  if (__DEV__) noteReceived(tabId, n);
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const window = tab ? s.windows[tab.windowId] : undefined;
  if (!tab || !window || window.incognito) return void webviews.get(tabId)?.notificationAction(n.id, "close");
  const id = macId(tabId, n);
  const entry = { tabId, engineId: n.id };
  shown.set(id, entry);
  let site = n.origin;
  try {
    site = new URL(n.origin).host;
  } catch {}
  void ensureNotificationPermission(tab.windowId).then(async (allowed) => {
    if (!allowed || shown.get(id) !== entry) return;
    const icon = n.icon ? await iconFor(tabId, n.icon) : undefined;
    if (shown.get(id) !== entry) return;
    void postNotification({
      id,
      title: n.title,
      body: n.body,
      subtitle: site,
      silent: n.silent,
      icon,
      tabId,
      windowId: tab.windowId,
      origin: n.origin,
      dismissible: true,
      data: { engineId: n.id },
    });
  });
}

const ICON_PIXELS = 128;
const ICON_TIMEOUT_MS = 3000;

async function iconFor(tabId: string, url: string): Promise<string | undefined> {
  const view = webviews.get(tabId);
  if (!view) return undefined;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ICON_TIMEOUT_MS));
  const image = await Promise.race([view.downloadImage(url, ICON_PIXELS).catch(() => null), timeout]);
  return image?.uri ?? undefined;
}

export function closeWebNotification(tabId: string, engineId: string) {
  if (__DEV__) for (const [id, n] of received) if (n.id === engineId) received.delete(id);
  for (const [id, entry] of shown) {
    if (entry.tabId !== tabId || entry.engineId !== engineId) continue;
    shown.delete(id);
    void removeNotifications([id]);
  }
}

export function handleWebNotificationResponse({ id, action, tabId, data }: NotificationResponse): boolean {
  if (!id.startsWith("web:")) return false;
  const engineId = (data as { engineId?: string } | null)?.engineId;
  if (engineId && shown.get(id)?.engineId === engineId) shown.delete(id);
  const tab = tabId ? useBrowser.getState().tabs[tabId] : undefined;
  if (!tab) return true;
  if (action === "click") {
    switchToTab(tab.id);
    focus(tab.windowId);
  }
  if (engineId) void webviews.get(tab.id)?.notificationAction(engineId, action);
  return true;
}

let asked = false;

export async function ensureNotificationPermission(windowId?: string): Promise<boolean> {
  const status = await notificationPermission();
  if (status === "granted" || status === "provisional") return true;
  if (status === "notDetermined") return requestNotificationPermission();
  if (asked) return false;
  asked = true;
  const { confirmed } = await confirm({
    title: "Ardia Needs Notifications Permission",
    message: "You need to open System Settings to give Ardia permission to show you Notifications.",
    confirmTitle: "Open System Settings",
    cancelTitle: "Not Now",
    windowId,
  });
  if (confirmed) void openNotificationSettings();
  return false;
}

if (__DEV__) (globalThis as { acNotifications?: unknown }).acNotifications = { shown };
