import type { CalendarParticipant, SystemCalendar } from "../../platform/calendar";
import type { CalendarEvent } from "./meetings";
import { endpoints, form, request } from "./net";
import { googleAccessToken } from "./sources";
import { live } from "./store";

const PREFIX = "gcal:";

export type GoogleCalendarEntry = { id: string; summary?: string; summaryOverride?: string; backgroundColor: string; accessRole?: string };

type GooglePerson = { email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean };
type GoogleTime = { date?: string; dateTime?: string };

export type GoogleEvent = {
  id: string;
  recurringEventId?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  organizer?: GooglePerson;
  attendees?: GooglePerson[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

export const isGoogleCalendarId = (calendarId: string) => calendarId.startsWith(PREFIX);

const STATUS: Record<string, CalendarParticipant["status"]> = { accepted: "accepted", declined: "declined", tentative: "tentative" };

const participant = (p: GooglePerson, status = p.responseStatus): CalendarParticipant => ({
  name: p.displayName ?? p.email ?? "",
  email: p.email ?? "",
  status: STATUS[status ?? ""] ?? "pending",
  me: !!p.self,
});

function time(t: GoogleTime | undefined): number | null {
  if (t?.dateTime) return Date.parse(t.dateTime);
  const day = t?.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime() : null;
}

export function mapGoogleCalendar(entry: GoogleCalendarEntry, account: string): SystemCalendar {
  return {
    id: `${PREFIX}${entry.id}`,
    title: entry.summaryOverride ?? entry.summary ?? entry.id,
    color: entry.backgroundColor,
    account,
    accountType: "other",
    owned: entry.accessRole === "owner",
  };
}

export function mapGoogleEvent(event: GoogleEvent, calendar: SystemCalendar): CalendarEvent | null {
  const start = time(event.start);
  const end = time(event.end);
  if (start === null || end === null || Number.isNaN(start) || Number.isNaN(end)) return null;
  const id = `${calendar.id}/${event.recurringEventId ?? event.id}`;
  const attendees = (event.attendees ?? []).filter((a) => !a.resource).map((a) => participant(a));
  return {
    id,
    occurrence: `${id}@${start}`,
    calendarId: calendar.id,
    color: calendar.color,
    title: event.summary ?? "",
    start,
    end,
    allDay: !event.start?.dateTime,
    location: event.location ?? "",
    notes: event.description ?? "",
    url: event.hangoutLink ?? event.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? "",
    cancelled: event.status === "cancelled",
    declined: attendees.some((a) => a.me && a.status === "declined"),
    organizer: event.organizer ? participant(event.organizer, "accepted") : null,
    attendees,
  };
}

const authorized = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

export async function googleCalendars(): Promise<SystemCalendar[]> {
  const token = await googleAccessToken("gcal");
  const list = await request<{ items?: GoogleCalendarEntry[] }>(`${endpoints.googleCalendar}/users/me/calendarList?maxResults=250`, authorized(token));
  const account = live().accounts.gcal?.login ?? "Google Calendar";
  return (list.items ?? []).map((entry) => mapGoogleCalendar(entry, account));
}

export async function googleCalendarEvents(start: number, end: number, calendars: SystemCalendar[]): Promise<CalendarEvent[]> {
  if (!calendars.length) return [];
  const token = await googleAccessToken("gcal");
  const query = form({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const pages = await Promise.allSettled(
    calendars.map(async (calendar) => {
      const page = await request<{ items?: GoogleEvent[] }>(`${endpoints.googleCalendar}/calendars/${encodeURIComponent(calendar.id.slice(PREFIX.length))}/events?${query}`, authorized(token));
      return (page.items ?? []).flatMap((e) => mapGoogleEvent(e, calendar) ?? []);
    }),
  );
  const loaded = pages.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
  if (!loaded.length) throw (pages[0] as PromiseRejectedResult).reason;
  return loaded.flat();
}
