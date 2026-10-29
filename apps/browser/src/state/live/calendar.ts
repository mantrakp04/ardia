import {
  calendarAuthorization,
  onCalendarChanged,
  requestCalendarAccess,
  systemCalendarEvents,
  systemCalendars,
  type CalendarAuthorization,
  type SystemCalendar,
} from "../../platform/calendar";
import { readDocument } from "../../platform/documents";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { devTestValue } from "../../platform/launchConfig";
import { everySlowly } from "../../platform/slowTimers";
import { errorText } from "../../lib/errors";
import { trackCalendarConnected } from "../telemetry/track";
import { googleCalendarEvents, googleCalendars, isGoogleCalendarId } from "./googleCalendar";
import type { CalendarEvent } from "./meetings";
import { googleAccessToken } from "./sources";
import { live, updateCalendarSettings, useLive } from "./store";

export type { SystemCalendar } from "../../platform/calendar";

type CalendarData = {
  access: CalendarAuthorization | "fixture";
  calendars: SystemCalendar[];
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  googleError: string | null;
  lastFetch: number | null;
};

export const useCalendar = create<CalendarData>()(() => ({
  access: "notDetermined",
  calendars: [],
  events: [],
  loading: false,
  error: null,
  googleError: null,
  lastFetch: null,
}));

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

type CalendarSnapshot = { calendars: SystemCalendar[]; events: CalendarEvent[] };

const NOTHING: CalendarSnapshot = { calendars: [], events: [] };

async function systemSnapshot(start: number, end: number): Promise<CalendarSnapshot> {
  const calendars = await systemCalendars();
  const ids = visible(calendars);
  return { calendars, events: ids.length ? await systemCalendarEvents(start, end, ids) : [] };
}

async function googleSnapshot(start: number, end: number): Promise<CalendarSnapshot> {
  const token = await googleAccessToken("gcal");
  const calendars = await googleCalendars(token);
  const ids = new Set(visible(calendars));
  return { calendars, events: await googleCalendarEvents(token, start, end, calendars.filter((c) => ids.has(c.id))) };
}

const keepPrevious = (google: boolean, { calendars, events }: CalendarSnapshot): CalendarSnapshot => ({
  calendars: calendars.filter((c) => isGoogleCalendarId(c.id) === google),
  events: events.filter((e) => isGoogleCalendarId(e.calendarId) === google),
});

type SourceResult = { on: boolean; data: CalendarSnapshot; error: string | null };

async function load(on: boolean, google: boolean, snapshot: () => Promise<CalendarSnapshot>): Promise<SourceResult> {
  if (!on) return { on, data: NOTHING, error: null };
  try {
    return { on, data: await snapshot(), error: null };
  } catch (error) {
    return { on, data: keepPrevious(google, useCalendar.getState()), error: errorText(error) };
  }
}

export const isSystemConnected = (access: CalendarData["access"]) => access === "fullAccess" || access === "fixture";
const isGoogleConnected = () => !!live().accounts.gcal;

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
      const start = new Date().setHours(0, 0, 0, 0);
      const end = Date.now() + HORIZON_MS;
      const [system, google] = await Promise.all([
        load(access === "fullAccess", false, () => systemSnapshot(start, end)),
        load(isGoogleConnected(), true, () => googleSnapshot(start, end)),
      ]);
      const fetched = [system, google].some((s) => s.on && !s.error);
      useCalendar.setState({
        access,
        calendars: [...system.data.calendars, ...google.data.calendars],
        events: [...system.data.events, ...google.data.events].sort((a, b) => a.start - b.start),
        error: system.error ?? google.error,
        googleError: google.error,
        lastFetch: fetched ? Date.now() : useCalendar.getState().lastFetch,
      });
    } catch (error) {
      useCalendar.setState({ error: errorText(error) });
    } finally {
      useCalendar.setState({ loading: false });
    }
  };
  inflight = run().finally(() => (inflight = null));
  return inflight;
}

export async function connectCalendar(): Promise<boolean> {
  if (fixtureMode) {
    await refreshCalendar();
    return true;
  }
  const granted = await requestCalendarAccess();
  await refreshCalendar();
  if (granted) trackCalendarConnected("macos");
  return granted;
}

export const calendarConnected = () => isSystemConnected(useCalendar.getState().access) || isGoogleConnected();

export function useCalendarConnected(): boolean {
  const system = useCalendar((s) => isSystemConnected(s.access));
  const google = useLive((s) => !!s.accounts.gcal);
  return system || google;
}

let started = false;

export function startCalendar() {
  if (started) return;
  started = true;
  void refreshCalendar();
  onCalendarChanged(() => void refreshCalendar());
  everySlowly({
    every: 5 * 60_000,
    run: () => void refreshCalendar(),
    needed: calendarConnected,
    watch: (changed) => {
      const system = useCalendar.subscribe((s, prev) => s.access !== prev.access && changed());
      const google = useLive.subscribe((s, prev) => s.accounts.gcal !== prev.accounts.gcal && changed());
      return () => {
        system();
        google();
      };
    },
  });
  useLive.subscribe((s, prev) => {
    if (s.calendar.hiddenCalendarIds !== prev.calendar.hiddenCalendarIds || s.accounts.gcal !== prev.accounts.gcal) void refreshCalendar();
    if (s.accounts.gcal && !prev.accounts.gcal) trackCalendarConnected("google");
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
