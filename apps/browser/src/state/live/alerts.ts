import { onAppEvent } from "../../platform/app";
import { onWindowEvent } from "../../platform/windows";
import { postNotification, removeNotifications } from "../../platform/notifications";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { useCalendar } from "./calendar";
import { joinMeeting } from "./meetingGroups";
import { ALERT_LEADS, dueAlerts, joinLink, joinTitle, relativeTime, type CalendarEvent } from "./meetings";
import { everySlowly } from "../../platform/slowTimers";
import { dismissAlert, live } from "./store";
import { focusedWindowOf } from "../windows/ui";

export const useMeetingAlert = create<{ event: CalendarEvent | null }>()(() => ({ event: null }));

let appActive = true;
const notified = new Set<string>();

export function alertEvent(now = Date.now()): CalendarEvent | null {
  const lead = ALERT_LEADS.find((l) => l.value === live().calendar.alertLead)?.minutes;
  if (lead === null || lead === undefined) return null;
  return dueAlerts(useCalendar.getState().events, now, lead, new Set(live().dismissedAlerts))[0] ?? null;
}

function check() {
  const event = alertEvent();
  const current = useMeetingAlert.getState().event;
  if (event?.occurrence !== current?.occurrence) useMeetingAlert.setState({ event });
  if (!event || appActive || live().calendar.alertCondition !== "always" || notified.has(event.occurrence)) return;
  notified.add(event.occurrence);
  const link = joinLink(event);
  const when = relativeTime(event.start, Date.now());
  void postNotification({
    id: `meeting:${event.occurrence}`,
    title: event.title || "Untitled event",
    body: `${when === "Now" ? "Starting now" : event.start < Date.now() ? `Started ${when}` : `Starts ${when}`}${link ? ` · ${joinTitle(link.provider)}` : ""}`,
    data: { meeting: event.occurrence },
  });
}

export function joinEvent(event: CalendarEvent, openAll = false, windowId = frontWindow()) {
  const link = joinLink(event);
  if (!link || !windowId) return;
  joinMeeting(windowId, event, link.url, openAll);
  dismiss(event);
}

export function dismiss(event: CalendarEvent) {
  dismissAlert(event.occurrence);
  void removeNotifications([`meeting:${event.occurrence}`]);
  if (useMeetingAlert.getState().event?.occurrence === event.occurrence) useMeetingAlert.setState({ event: null });
  check();
}

const frontWindow = () => {
  const s = useBrowser.getState();
  const id = focusedWindowOf(s);
  return id && s.windows[id] && s.windows[id]!.kind !== "private" ? id : s.windowOrder.find((w) => s.windows[w]!.kind !== "private");
};

let started = false;

export function startMeetingAlerts() {
  if (started) return;
  started = true;
  onAppEvent((e) => {
    if (e.type === "resignActive") appActive = false;
  });
  onWindowEvent((e) => {
    if (e.type === "focus") appActive = true;
  });
  useCalendar.subscribe((s, prev) => s.events !== prev.events && check());
  everySlowly({
    every: 10_000,
    run: check,
    needed: () => useCalendar.getState().events.length > 0 || !!useMeetingAlert.getState().event,
    watch: (changed) => {
      const calendar = useCalendar.subscribe(changed);
      const alert = useMeetingAlert.subscribe(changed);
      return () => (calendar(), alert());
    },
  });
  check();
}
