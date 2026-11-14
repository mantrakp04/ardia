import { startEventFeed, stopEventFeed } from "./automationEvents";
import { CORE_EVENTS, type AutomationEventName } from "./eventNames";
import { startLifecycleEvents, startUserIdleEvents } from "./lifecycleEvents";
import { startStoreEvents, type EventSend } from "./storeEvents";
import { setNotificationSink } from "./notificationEvents";
import type { Subscription } from "./automationMethods";

export type FeedNeeds = { events: Set<AutomationEventName>; tabIdle: Set<number>; userIdle: Set<number> };

type Family = { key: string; stop: () => void };

const families = new Map<string, Family>();
let coreOn = false;

export function feedNeeds(subscriptions: Iterable<Subscription>): FeedNeeds {
  const needs: FeedNeeds = { events: new Set(), tabIdle: new Set(), userIdle: new Set() };
  for (const sub of subscriptions) {
    for (const name of sub.events) needs.events.add(name);
    for (const t of sub.tabIdle) needs.tabIdle.add(t);
    for (const t of sub.userIdle) needs.userIdle.add(t);
  }
  return needs;
}

function keep(name: string, key: string | null, start: () => () => void) {
  const current = families.get(name);
  if (current?.key === key) return;
  current?.stop();
  families.delete(name);
  if (key === null) return;
  families.set(name, { key, stop: start() });
}

const sorted = (values: Iterable<string | number>) => [...values].map(String).sort().join(",");

export function updateFeed(needs: FeedNeeds, send: EventSend) {
  const wantsCore = [...needs.events].some((name) => CORE_EVENTS.has(name));
  if (wantsCore && !coreOn) startEventFeed(send);
  if (!wantsCore && coreOn) stopEventFeed();
  coreOn = wantsCore;
  const storeKey = `${sorted(needs.events)}|${sorted(needs.tabIdle)}`;
  keep("store", needs.events.size ? storeKey : null, () => startStoreEvents(send, needs));
  keep("lifecycle", needs.events.size ? sorted(needs.events) : null, () => startLifecycleEvents(send, needs.events));
  keep("notification", needs.events.has("notification.shown") ? "on" : null, () => {
    setNotificationSink(send);
    return () => setNotificationSink(null);
  });
  keep("userIdle", needs.userIdle.size ? `${sorted(needs.events)}|${sorted(needs.userIdle)}` : null, () => startUserIdleEvents(send, needs.events, needs.userIdle));
}

export function stopFeed() {
  if (coreOn) stopEventFeed();
  coreOn = false;
  for (const family of families.values()) family.stop();
  families.clear();
}
