import { useBrowser } from "../browser/store";
import { isEligibleTab } from "./automationWindows";
import type { EventSend } from "./storeEvents";

export const NOTIFICATION_TITLE_LIMIT = 200;
export const NOTIFICATION_BODY_LIMIT = 500;

let sink: EventSend | null = null;

export const setNotificationSink = (send: EventSend | null) => {
  sink = send;
};

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

export function noteNotificationShown(tabId: string, n: { origin: string; title: string; body: string }) {
  const s = useBrowser.getState();
  if (!sink || !isEligibleTab(s, tabId)) return;
  const t = s.tabs[tabId]!;
  sink("notification.shown", {
    windowId: t.windowId,
    tabId,
    profile: t.profileId,
    origin: n.origin,
    title: cut(n.title ?? "", NOTIFICATION_TITLE_LIMIT),
    body: cut(n.body ?? "", NOTIFICATION_BODY_LIMIT),
  });
}
