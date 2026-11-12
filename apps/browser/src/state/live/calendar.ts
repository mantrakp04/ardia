import {
  calendarAuthorization,
  onCalendarChanged,
  requestCalendarAccess,
  systemCalendarEvents,
  systemCalendars,
  type CalendarAccessRequest,
  type CalendarAuthorization,
  type SystemCalendar,
} from "../../platform/calendar";
import { openExternalURL } from "../../platform/app";
import { readDocument } from "../../platform/documents";
import { onWindowEvent } from "../../platform/windows";
import { trackCalendarConnect } from "../telemetry/track";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { devTestValue } from "../../platform/launchConfig";
import { everySlowly } from "../../platform/slowTimers";
import type { CalendarEvent } from "./meetings";
import { live, updateCalendarSettings, useLive } from "./store";

export type { SystemCalendar } from "../../platform/calendar";

type CalendarData = {
  access: CalendarAuthorization | "fixture";
  calendars: SystemCalendar[];
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  requesting: boolean;
  requestError: string | null;
};

export const useCalendar = create<CalendarData>()(() => ({
  access: "notDetermined",
  calendars: [],
  events: [],
  loading: false,
  error: null,
  lastFetch: null,
  requesting: false,
  requestError: null,
}));

const CALENDARS_PRIVACY = "System Settings › Privacy & Security › Calendars";

export const openCalendarPrivacy = () => void openExternalURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars");

export const calendarBlocked = (access: CalendarData["access"]) => access === "denied" || access === "restricted" || access === "writeOnly";

export function calendarRequestFailure(access: CalendarAuthorization, request: Pick<CalendarAccessRequest, "error" | "responsible"> | null): string | null {
  if (access === "fullAccess") return null;
  if (access === "restricted") return `Calendar access is restricted on this Mac, by Screen Time or your organization. If you can change it, allow Ardia in ${CALENDARS_PRIVACY}.`;
  if (access === "writeOnly") return `Ardia can only add events to your calendars. Choose Full Access for Ardia in ${CALENDARS_PRIVACY}.`;
  if (access === "denied") return `Ardia isn't allowed to read your calendars. Turn on Ardia in ${CALENDARS_PRIVACY}.`;
  const launcherHint = request?.responsible === "other" ? " macOS may have checked the app that opened Ardia instead of Ardia: quit Ardia, open it from the Dock or Finder, then connect again." : "";
  if (request?.error) return `macOS couldn't give Ardia calendar access (${request.error}). Check ${CALENDARS_PRIVACY}.${launcherHint}`;
  if (launcherHint) return `macOS didn't ask Ardia for calendar access.${launcherHint}`;
  return `macOS didn't ask for calendar access. Allow Ardia in ${CALENDARS_PRIVACY}.`;
}

const HORIZON_MS = 36 * 3_600_000;

type Fixture = {
  calendars: SystemCalendar[];
  events: (Omit<CalendarEvent, "start" | "end" | "occurrence"> & { startInMinutes: number; durationMinutes: number })[];
};

const fixtureMode = (() => {
  try {
    return devTestValue("calendarFixture") === "1";
  } catch {
    return false;
  }
})();
const launchedAt = Date.now();

function loadFixture(): { calendars: SystemCalendar[]; events: CalendarEvent[] } {
  const raw = JSON.parse(readDocument("calendar-fixture.json") ?? '{"calendars":[],"events":[]}') as Fixture;
  const base = Math.floor(launchedAt / 60_000) * 60_000;
  const events = raw.events.map(({ startInMinutes, durationMinutes, ...e }) => {
    const start = base + startInMinutes * 60_000;
    return { ...e, start, end: start + durationMinutes * 60_000, occurrence: `${e.id}@${start}` };
  });
  return { calendars: raw.calendars, events };
}

const visible = (calendars: SystemCalendar[]) => {
  const hidden = new Set(live().calendar.hiddenCalendarIds);
  return calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id);
};

let inflight: Promise<void> | null = null;

export function refreshCalendar(): Promise<void> {
  if (inflight) return inflight;
  const run = async () => {
    useCalendar.setState({ loading: true });
    try {
      if (fixtureMode) {
        const { calendars, events } = loadFixture();
        const ids = new Set(visible(calendars));
        useCalendar.setState({ access: "fixture", calendars, events: events.filter((e) => ids.has(e.calendarId)), error: null, lastFetch: Date.now() });
        return;
      }
      const access = calendarAuthorization();
      if (access !== "fullAccess") {
        const changed = access !== useCalendar.getState().access;
        useCalendar.setState({ access, calendars: [], events: [], error: null, ...(changed ? { requestError: null } : {}) });
        return;
      }
      const calendars = await systemCalendars();
      const ids = visible(calendars);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const events = ids.length ? await systemCalendarEvents(start.getTime(), Date.now() + HORIZON_MS, ids) : [];
      useCalendar.setState({ access, calendars, events: events.sort((a, b) => a.start - b.start), error: null, requestError: null, lastFetch: Date.now() });
    } catch (error) {
      useCalendar.setState({ error: String((error as Error)?.message ?? error) });
    } finally {
      useCalendar.setState({ loading: false });
    }
  };
  inflight = run().finally(() => (inflight = null));
  return inflight;
}

let connecting: Promise<boolean> | null = null;

async function askMacOS(): Promise<CalendarAccessRequest> {
  try {
    return await requestCalendarAccess();
  } catch (error) {
    return { granted: false, status: calendarAuthorization(), error: String((error as Error)?.message ?? error), responsible: "unknown", ms: 0 };
  }
}

async function requestAccess(): Promise<boolean> {
  const before = calendarAuthorization();
  if (before === "fullAccess") {
    await refreshCalendar();
    return true;
  }
  useCalendar.setState({ requesting: true, requestError: null });
  const request = before === "notDetermined" ? await askMacOS() : null;
  await refreshCalendar();
  const access = calendarAuthorization();
  const failure = calendarRequestFailure(access, request);
  useCalendar.setState({ requesting: false, requestError: failure });
  const settingsOpened = !!failure && (request ? access === "notDetermined" && request.responsible !== "other" : true);
  if (settingsOpened) openCalendarPrivacy();
  trackCalendarConnect({ before, after: access, responsible: request?.responsible ?? "unknown", errored: !!request?.error, settingsOpened, ms: request?.ms ?? 0 });
  return access === "fullAccess";
}

export function connectCalendar(): Promise<boolean> {
  if (fixtureMode) return refreshCalendar().then(() => true);
  connecting ??= requestAccess().finally(() => (connecting = null));
  return connecting;
}

export const calendarConnected = () => {
  const access = useCalendar.getState().access;
  return access === "fullAccess" || access === "fixture";
};

let started = false;

export function startCalendar() {
  if (started) return;
  started = true;
  void refreshCalendar();
  onCalendarChanged(() => void refreshCalendar());
  onWindowEvent((e) => {
    if (e.type === "focus" && !calendarConnected() && calendarAuthorization() !== useCalendar.getState().access) void refreshCalendar();
  });
  everySlowly({
    every: 5 * 60_000,
    run: () => void refreshCalendar(),
    needed: calendarConnected,
    watch: (changed) => useCalendar.subscribe((s, prev) => s.access !== prev.access && changed()),
  });
  useLive.subscribe((s, prev) => {
    if (s.calendar.hiddenCalendarIds !== prev.calendar.hiddenCalendarIds) void refreshCalendar();
  });
}

export const setCalendarHidden = (id: string, hidden: boolean) => {
  const ids = live().calendar.hiddenCalendarIds.filter((c) => c !== id);
  updateCalendarSettings({ hiddenCalendarIds: hidden ? [...ids, id] : ids });
};

export function useNow(intervalMs = 15_000, enabled = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
