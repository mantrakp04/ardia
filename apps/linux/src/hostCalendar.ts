import type { CalendarAuthorization, CalendarParticipant, SystemCalendar, SystemCalendarEvent } from "../../../packages/shell/src/live";
import { ardiaHost, hostSupports, invokeHost, type ArdiaHost } from "./host.ts";
import {
  events as veventsOf,
  ianaName,
  ianaZone,
  inlineZones,
  occurrences,
  parseIcs,
  properties,
  property,
  referencedTzids,
  unescapeText,
  vtimezoneZone,
  type ExpansionBudget,
  type IcsComponent,
  type IcsProperty,
  type Zone,
} from "./calendarIcs.ts";

export const CALENDAR_CONSENT_DOCUMENT = "linux-calendar.json";
export const CALENDAR_CAPABILITIES = ["ArdiaCalendar.status", "ArdiaCalendar.requestAccess", "ArdiaCalendar.sources", "ArdiaCalendar.objects", "ArdiaCalendar.timezones"] as const;
const DEFAULT_COLOR = "#8E8E93";
const EXPANSION_BUDGET_MS = 750;
const STATUSES: ReadonlySet<string> = new Set(["notDetermined", "fullAccess", "restricted", "denied"]);
const READ_ONLY_BACKENDS = new Set(["webcal", "contacts", "weather"]);
const ACCOUNT_FALLBACK: Record<string, string> = { local: "On This Computer", webcal: "On The Web", contacts: "Contacts", weather: "Weather" };

export type EdsSourceData = Record<string, Record<string, string>>;
export type EdsSource = { uid: string; calendar: boolean; data: EdsSourceData };
type CalendarObjects = { status: string; message: string; objects?: unknown[]; truncated?: boolean };
export type CalendarRefreshReport = { truncatedCalendars: string[]; truncatedEvents: string[]; skippedObjects: number; failedCalendars: string[] };
type KnownCalendar = SystemCalendar & { emails: string[] };

export type LinuxCalendar = {
  authorizationStatus(): CalendarAuthorization;
  message(): string;
  requestAccess(): Promise<boolean>;
  calendars(): Promise<SystemCalendar[]>;
  events(start: number, end: number, calendarIds: string[]): Promise<SystemCalendarEvent[]>;
  lastRefresh(): CalendarRefreshReport;
};

export function consentGranted(host: ArdiaHost): boolean {
  try {
    const saved = JSON.parse(host.bootstrap.documents?.[CALENDAR_CONSENT_DOCUMENT] ?? "null") as { version?: unknown; connected?: unknown } | null;
    return saved?.version === 1 && saved.connected === true;
  } catch {
    return false;
  }
}

export function normalizeColor(color: string | undefined): string {
  const value = color?.trim() ?? "";
  const hex = /^#([0-9a-f]+)$/i.exec(value)?.[1];
  if (hex && [3, 6, 8, 12].includes(hex.length)) {
    const channel = (i: number) => hex.length === 3 ? hex[i]!.repeat(2) : hex.length === 12 ? hex.slice(i * 4, i * 4 + 2) : hex.slice(i * 2, i * 2 + 2);
    return `#${channel(0)}${channel(1)}${channel(2)}`.toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(value);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((c) => Math.min(255, +c!).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return DEFAULT_COLOR;
}

function accountType(backend: string): SystemCalendar["accountType"] {
  if (backend === "local") return "local";
  if (backend === "caldav" || backend === "google") return "calDAV";
  if (backend === "webcal") return "subscribed";
  if (backend === "contacts") return "birthdays";
  if (backend === "ews" || backend === "microsoft365" || backend === "exchange-mapi" || backend === "mapi") return "exchange";
  return "other";
}

export function calendarsFromSources(sources: EdsSource[]): KnownCalendar[] {
  const byUid = new Map(sources.map((source) => [source.uid, source]));
  const enabled = (source: EdsSource | undefined) => source?.data["Data Source"]?.Enabled?.toLowerCase() !== "false";
  const calendars: KnownCalendar[] = [];
  for (const source of sources) {
    if (!source.calendar || !source.data.Calendar || !enabled(source)) continue;
    const parent = byUid.get(source.data["Data Source"]?.Parent ?? "");
    if (parent && (!enabled(parent) || parent.data.Collection?.CalendarEnabled?.toLowerCase() === "false")) continue;
    const backend = source.data.Calendar.BackendName?.toLowerCase() ?? "";
    const emails = [
      source.data["WebDAV Backend"]?.EmailAddress, source.data.Authentication?.User, source.data["Ews Backend"]?.Email,
      parent?.data.Collection?.Identity, parent?.data.Authentication?.User, parent?.data["Mail Identity"]?.Address,
    ].filter((email): email is string => !!email && email.includes("@")).map((email) => email.trim().toLowerCase());
    calendars.push({
      id: source.uid,
      title: source.data["Data Source"]?.DisplayName || source.uid,
      color: normalizeColor(source.data.Calendar.Color),
      account: parent?.data["Data Source"]?.DisplayName || ACCOUNT_FALLBACK[backend] || "",
      accountType: accountType(backend),
      owned: !READ_ONLY_BACKENDS.has(backend),
      emails: [...new Set(emails)],
    });
  }
  return calendars;
}

const PARTSTAT: Record<string, CalendarParticipant["status"]> = { ACCEPTED: "accepted", DECLINED: "declined", TENTATIVE: "tentative" };
const CONFERENCE = ["URL", "X-GOOGLE-CONFERENCE", "X-MICROSOFT-SKYPETEAMSMEETINGURL", "CONFERENCE"];

function participant(p: IcsProperty, emails: Set<string>): CalendarParticipant {
  const email = /^mailto:/i.test(p.value.trim()) ? p.value.trim().slice(7) : p.params.EMAIL ?? "";
  return {
    name: p.params.CN ?? "",
    email,
    status: PARTSTAT[p.params.PARTSTAT?.toUpperCase() ?? ""] ?? "pending",
    me: !!email && emails.has(email.toLowerCase()),
  };
}

export function eventFields(event: IcsComponent, calendar: KnownCalendar): Omit<SystemCalendarEvent, "start" | "end" | "allDay" | "occurrence"> {
  const emails = new Set(calendar.emails);
  const organizer = property(event, "ORGANIZER");
  const attendees = properties(event, "ATTENDEE")
    .filter((p) => !["ROOM", "RESOURCE"].includes(p.params.CUTYPE?.toUpperCase() ?? ""))
    .map((p) => participant(p, emails));
  const text = (name: string) => unescapeText(property(event, name)?.value ?? "");
  const url = CONFERENCE.map((name) => property(event, name)?.value.trim() ?? "").find((value) => /^https?:\/\//i.test(value)) ?? "";
  return {
    id: `${calendar.id}/${property(event, "UID")?.value ?? ""}`,
    calendarId: calendar.id,
    color: calendar.color,
    title: text("SUMMARY"),
    location: text("LOCATION"),
    notes: text("DESCRIPTION"),
    url,
    cancelled: property(event, "STATUS")?.value.trim().toUpperCase() === "CANCELLED",
    declined: attendees.some((a) => a.me && a.status === "declined"),
    organizer: organizer ? participant(organizer, emails) : null,
    attendees,
  };
}

export function zoneLookup(inline: Map<string, IcsComponent>, fetched: Map<string, string | null>): (tzid: string) => Zone | null {
  const cache = new Map<string, Zone | null>();
  return (tzid) => {
    if (cache.has(tzid)) return cache.get(tzid)!;
    const iana = ianaName(tzid);
    let zone: Zone | null = iana ? ianaZone(iana) : null;
    if (!zone) {
      const component = inline.get(tzid) ?? parseIcs(fetched.get(tzid) ?? "").flatMap((c) => c.name === "VTIMEZONE" ? [c] : c.components.filter((x) => x.name === "VTIMEZONE"))[0];
      zone = component ? vtimezoneZone(component) : null;
    }
    cache.set(tzid, zone);
    return zone;
  };
}

export function parseObjects(objects: unknown[]): { components: IcsComponent[]; skipped: number } {
  const components: IcsComponent[] = [];
  let skipped = 0;
  for (const object of objects) {
    try {
      if (typeof object !== "string") throw new Error("not iCalendar text");
      components.push(...parseIcs(object));
    } catch {
      skipped++;
    }
  }
  return { components, skipped };
}

export function calendarEvents(components: IcsComponent[], calendar: KnownCalendar, start: number, end: number, fetched = new Map<string, string | null>(), budget?: ExpansionBudget): SystemCalendarEvent[] {
  const lookup = zoneLookup(inlineZones(components), fetched);
  return occurrences(veventsOf(components), start, end, lookup, budget).map((found) => ({
    ...eventFields(found.event, calendar),
    start: found.start,
    end: found.end,
    allDay: found.allDay,
    occurrence: `${calendar.id}/${property(found.event, "UID")?.value ?? ""}@${Math.floor(found.start / 1000)}`,
  }));
}

export function missingTzids(components: IcsComponent[]): string[] {
  const inline = inlineZones(components);
  return [...referencedTzids(components)].filter((tzid) => !inline.has(tzid) && !ianaName(tzid));
}

const calendarError = (code: string, message: string) => Object.assign(new Error(message), { code });

export function createLinuxCalendar(host: ArdiaHost): LinuxCalendar {
  const supported = CALENDAR_CAPABILITIES.every((method) => hostSupports(method, host));
  let status: CalendarAuthorization = !supported ? "restricted" : consentGranted(host) ? "fullAccess" : "notDetermined";
  let message = supported ? "" : "This Ardia engine was built without the Linux calendar service";
  let known: KnownCalendar[] = [];
  let report: CalendarRefreshReport = { truncatedCalendars: [], truncatedEvents: [], skippedObjects: 0, failedCalendars: [] };
  const invoke = <T>(method: string, args: unknown[]) => invokeHost<T>(`ArdiaCalendar.${method}`, { args }, host);
  const adopt = (next: unknown, detail?: unknown) => {
    if (!supported || typeof next !== "string" || !STATUSES.has(next)) return;
    status = next as CalendarAuthorization;
    message = typeof detail === "string" ? detail : "";
  };
  const fail = (error: unknown): never => {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ERR_CALENDAR_UNAVAILABLE") adopt("restricted", (error as Error).message);
    if (code === "ERR_CALENDAR_DENIED") adopt("denied", (error as Error).message);
    if (code === "ERR_CALENDAR_NOT_CONNECTED") adopt("notDetermined");
    throw error;
  };
  host.onEvent((module, event, payload) => {
    if (module !== "ArdiaCalendar" || event !== "onCalendarChanged" || !payload || typeof payload !== "object") return;
    const change = payload as { status?: unknown; message?: unknown };
    adopt(change.status, change.message);
  });
  if (supported) {
    void invoke<{ status?: unknown; message?: unknown }>("status", []).then((reply) => adopt(reply?.status, reply?.message), () => {});
  }
  const sources = async () => {
    const reply = await invoke<{ sources?: unknown }>("sources", []).catch(fail);
    if (!Array.isArray(reply?.sources)) throw calendarError("ERR_BAD_REPLY", "Evolution Data Server sent an unreadable source list");
    known = calendarsFromSources(reply.sources as EdsSource[]);
    return known;
  };
  return {
    authorizationStatus: () => status,
    message: () => message,
    lastRefresh: () => report,
    async requestAccess() {
      if (!supported) return false;
      const reply = await invoke<{ granted?: unknown; status?: unknown; message?: unknown }>("requestAccess", []).catch(fail);
      adopt(reply?.status, reply?.message);
      return reply?.granted === true;
    },
    async calendars() {
      if (status !== "fullAccess") return [];
      return (await sources()).map(({ emails: _, ...calendar }) => calendar);
    },
    async events(start, end, calendarIds) {
      if (status !== "fullAccess") return [];
      if (!known.length) await sources();
      const wanted = calendarIds.length ? known.filter((c) => calendarIds.includes(c.id)) : known;
      if (!wanted.length) return [];
      const reply = await invoke<{ calendars?: Record<string, CalendarObjects> }>("objects", [wanted.map((c) => c.id), start, end]).catch(fail);
      const results = reply?.calendars ?? {};
      const found: SystemCalendarEvent[] = [];
      const failures: CalendarObjects[] = [];
      const budget: ExpansionBudget = { deadline: performance.now() + EXPANSION_BUDGET_MS, truncated: [] };
      const next: CalendarRefreshReport = { truncatedCalendars: [], truncatedEvents: [], skippedObjects: 0, failedCalendars: [] };
      for (const calendar of wanted) {
        const result = results[calendar.id];
        if (!result || result.status !== "ok" || !Array.isArray(result.objects)) {
          failures.push(result ?? { status: "failed", message: `${calendar.title} didn't answer` });
          next.failedCalendars.push(calendar.id);
          continue;
        }
        if (result.truncated) next.truncatedCalendars.push(calendar.id);
        try {
          const { components, skipped } = parseObjects(result.objects);
          next.skippedObjects += skipped;
          const missing = missingTzids(components);
          const fetched = new Map<string, string | null>();
          if (missing.length) {
            const zones = await invoke<{ timezones?: Record<string, string | null> }>("timezones", [calendar.id, missing.slice(0, 64)]).catch(() => ({ timezones: {} }));
            for (const [tzid, ics] of Object.entries(zones?.timezones ?? {})) fetched.set(tzid, typeof ics === "string" ? ics : null);
          }
          const before = budget.truncated.length;
          found.push(...calendarEvents(components, calendar, start, end, fetched, budget));
          next.truncatedEvents.push(...budget.truncated.slice(before).map((uid) => `${calendar.id}/${uid}`));
        } catch (error) {
          failures.push({ status: "failed", message: `${calendar.title} couldn't be read: ${String((error as Error)?.message ?? error)}` });
          next.failedCalendars.push(calendar.id);
        }
      }
      report = next;
      if (next.truncatedCalendars.length || next.truncatedEvents.length || next.skippedObjects) {
        console.warn("[ardia linux] calendar refresh incomplete", next);
      }
      if (failures.length === wanted.length) {
        const denied = failures.find((f) => f.status === "denied");
        throw calendarError(denied ? "ERR_CALENDAR_DENIED" : "ERR_CALENDAR_FAILED", (denied ?? failures[0])!.message || "Ardia couldn't read your calendars");
      }
      if (failures.length) console.warn("[ardia linux] calendars skipped", failures.map((f) => f.message));
      return found.sort((a, b) => a.start - b.start);
    },
  };
}

const calendars = new WeakMap<ArdiaHost, LinuxCalendar>();

export function linuxCalendar(host: ArdiaHost): LinuxCalendar {
  let calendar = calendars.get(host);
  if (!calendar) {
    calendar = createLinuxCalendar(host);
    calendars.set(host, calendar);
  }
  return calendar;
}

if (ardiaHost) linuxCalendar(ardiaHost);

export function calendarModuleMethod(host: ArdiaHost, name: string, method: string): ((...args: never[]) => unknown) | undefined {
  if (name !== "ArdiaCalendar") return undefined;
  const calendar = linuxCalendar(host);
  switch (method) {
    case "authorizationStatus": return () => calendar.authorizationStatus();
    case "requestAccess": return () => calendar.requestAccess();
    case "calendars": return () => calendar.calendars();
    case "events": return (start: number, end: number, ids: string[]) => calendar.events(start, end, Array.isArray(ids) ? ids : []);
  }
  return undefined;
}
