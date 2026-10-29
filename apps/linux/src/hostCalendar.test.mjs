process.env.TZ = "America/Los_Angeles";

import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";
import { CALENDAR_CAPABILITIES, calendarsFromSources, linuxCalendar, normalizeColor } from "./hostCalendar.ts";

const WORK = {
  uid: "work",
  calendar: true,
  data: {
    "Data Source": { DisplayName: "Work", Enabled: "true", Parent: "goa" },
    Calendar: { BackendName: "caldav", Color: "#62a0ea" },
    "WebDAV Backend": { EmailAddress: "Me@Example.com" },
  },
};
const PERSONAL = { uid: "personal", calendar: true, data: { "Data Source": { DisplayName: "Personal", Parent: "local-stub" }, Calendar: { BackendName: "local", Color: "#becedd" } } };
const HOLIDAYS = { uid: "holidays", calendar: true, data: { "Data Source": { DisplayName: "Holidays", Parent: "webcal-stub" }, Calendar: { BackendName: "webcal", Color: "rgb(255,0,128)" } } };
const SOURCES = [
  WORK, PERSONAL, HOLIDAYS,
  { uid: "goa", calendar: false, data: { "Data Source": { DisplayName: "me@example.com" }, Collection: { BackendName: "google", Identity: "me@example.com" } } },
  { uid: "local-stub", calendar: false, data: { "Data Source": { DisplayName: "On This Computer" } } },
  { uid: "chores", calendar: false, data: { "Data Source": { DisplayName: "Chores" }, "Task List": { BackendName: "local" } } },
  { uid: "off", calendar: true, data: { "Data Source": { DisplayName: "Off", Enabled: "false" }, Calendar: { BackendName: "local" } } },
  { uid: "orphaned", calendar: true, data: { "Data Source": { DisplayName: "Orphaned", Parent: "gone" }, Calendar: { BackendName: "caldav" } } },
  { uid: "disabled-account", calendar: true, data: { "Data Source": { DisplayName: "Old job", Parent: "old" }, Calendar: { BackendName: "ews" } } },
  { uid: "old", calendar: false, data: { "Data Source": { DisplayName: "old@example.com", Enabled: "false" }, Collection: { BackendName: "ews" } } },
];

const vevent = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT", ""].join("\r\n");
const STANDUP = vevent([
  "UID:standup", "SUMMARY:Standup", "DTSTART;TZID=America/New_York:20261019T090000", "DTEND;TZID=America/New_York:20261019T093000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z", "EXDATE;TZID=America/New_York:20261104T090000",
]);
const MOVED = vevent([
  "UID:standup", "SUMMARY:Standup (moved)", "RECURRENCE-ID;TZID=America/New_York:20261102T090000",
  "DTSTART;TZID=America/New_York:20261102T100000", "DTEND;TZID=America/New_York:20261102T103000",
]);
const ELECTION = vevent(["UID:election", "SUMMARY:Election Day", "DTSTART;VALUE=DATE:20261103", "DTEND;VALUE=DATE:20261104"]);
const DECLINED = vevent([
  "UID:review", "SUMMARY:Design review", "DTSTART:20261103T170000Z", "DTEND:20261103T180000Z", "ORGANIZER;CN=Ana:mailto:ana@example.com",
  "ATTENDEE;CN=Me;PARTSTAT=DECLINED:mailto:ME@example.com", "ATTENDEE;CN=Big Room;CUTYPE=ROOM:mailto:room@example.com",
  "ATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:ana@example.com", "LOCATION:Room 4\\, second floor", "DESCRIPTION:Agenda:\\nbring notes",
]);
const CANCELLED = vevent(["UID:dinner", "SUMMARY:Team dinner", "STATUS:CANCELLED", "DTSTART;TZID=/freedesktop.org/Tzfile/Europe/Berlin:20261104T180000", "DURATION:PT45M"]);
const CUSTOM_ZONE = [
  "BEGIN:VCALENDAR", "BEGIN:VTIMEZONE", "TZID:Custom Standard Time",
  "BEGIN:STANDARD", "DTSTART:16010101T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11", "END:STANDARD",
  "BEGIN:DAYLIGHT", "DTSTART:16010101T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3", "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:sync", "SUMMARY:Sync", "DTSTART;TZID=Custom Standard Time:20261105T120000", "DTEND;TZID=Custom Standard Time:20261105T123000",
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij", "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n");
const FETCHED_ZONE = vevent(["UID:berlin", "SUMMARY:Berlin call", "DTSTART;TZID=W. Europe Standard Time:20261105T080000", "DTEND;TZID=W. Europe Standard Time:20261105T090000"]);
const WINDOWS_ZONE = [
  "BEGIN:VTIMEZONE", "TZID:W. Europe Standard Time",
  "BEGIN:STANDARD", "DTSTART:16011028T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10", "END:STANDARD",
  "BEGIN:DAYLIGHT", "DTSTART:16010325T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3", "END:DAYLIGHT",
  "END:VTIMEZONE", "",
].join("\r\n");
const LUNCH = vevent(["UID:lunch", "SUMMARY:Lunch", "DTSTART:20261104T120000", "DTEND:20261104T130000"]);
const START = Date.UTC(2026, 10, 2);
const END = Date.UTC(2026, 10, 6);

function fixture({ capabilities = CALENDAR_CAPABILITIES, consent = false, replies = {} } = {}) {
  const listeners = new Set();
  const requests = [];
  const answers = {
    status: () => ({ status: "fullAccess", available: true, message: "" }),
    requestAccess: () => ({ granted: true, status: "fullAccess", message: "" }),
    sources: () => ({ sources: SOURCES }),
    objects: ([ids]) => ({ calendars: Object.fromEntries(ids.map((id) => [id, { status: "ok", message: "", objects: { work: [STANDUP, MOVED, ELECTION, DECLINED, CANCELLED, CUSTOM_ZONE, FETCHED_ZONE], personal: [LUNCH] }[id] ?? [] }])) }),
    timezones: ([, tzids]) => ({ timezones: Object.fromEntries(tzids.map((tzid) => [tzid, tzid === "W. Europe Standard Time" ? WINDOWS_ZONE : null])) }),
    ...replies,
  };
  const host = {
    bootstrap: {
      windowId: "w_calendar", profileId: "default", capabilities: [...capabilities],
      documents: consent ? { "linux-calendar.json": '{"version":1,"connected":true}' } : {},
    },
    call: async () => "{}",
    invoke: async (method, { args }) => {
      requests.push([method, args]);
      const answer = answers[method.replace("ArdiaCalendar.", "")];
      if (!answer) throw new Error(`Unexpected ${method}`);
      return answer(args);
    },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const calendar = (method) => resolveHostModule(host, "ArdiaCalendar", method);
  const emit = (payload) => { for (const listener of [...listeners]) listener("ArdiaCalendar", "onCalendarChanged", payload); };
  return { host, requests, calendar, emit, listeners };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the Linux calendar reports explicit states instead of a hardcoded denial", async () => {
  assert.equal(fixture({ capabilities: [] }).calendar("authorizationStatus")(), "restricted");
  const fresh = fixture();
  assert.equal(fresh.calendar("authorizationStatus")(), "notDetermined");
  assert.deepEqual(await fresh.calendar("calendars")(), []);
  assert.deepEqual(await fresh.calendar("events")(START, END, ["work"]), []);
  await tick();
  assert.deepEqual(fresh.requests.map(([method]) => method), ["ArdiaCalendar.status"]);
  const later = fixture({ replies: { status: () => ({ status: "notDetermined", available: true, message: "" }) } });
  assert.equal(later.calendar("authorizationStatus")(), "notDetermined");
  await tick();
  later.emit({ status: "fullAccess", message: "", reason: "status" });
  assert.equal(later.calendar("authorizationStatus")(), "fullAccess");
  const connected = fixture({ consent: true });
  assert.equal(connected.calendar("authorizationStatus")(), "fullAccess");
  await tick();
  assert.deepEqual(connected.requests.map(([method]) => method), ["ArdiaCalendar.status"]);
});

test("connecting asks the native service and adopts its answer", async () => {
  const granted = fixture();
  assert.equal(await granted.calendar("requestAccess")(), true);
  assert.equal(granted.calendar("authorizationStatus")(), "fullAccess");
  const missing = fixture({ replies: { requestAccess: () => ({ granted: false, status: "restricted", message: "Evolution Data Server isn't installed or running in this session" }) } });
  assert.equal(await missing.calendar("requestAccess")(), false);
  assert.equal(missing.calendar("authorizationStatus")(), "restricted");
  assert.equal(await fixture({ capabilities: [] }).calendar("requestAccess")(), false);
});

test("a status broadcast is adopted before the shared refresh listener reads it", () => {
  const { calendar, emit, listeners } = fixture({ consent: true });
  assert.equal(calendar("authorizationStatus")(), "fullAccess");
  const seen = [];
  listeners.add((module) => module === "ArdiaCalendar" && seen.push(calendar("authorizationStatus")()));
  emit({ status: "restricted", message: "Evolution Data Server stopped answering", reason: "status" });
  emit({ status: "unknown", reason: "service" });
  emit({ status: "denied", message: "refused" });
  emit({ status: "fullAccess", reason: "objects" });
  assert.deepEqual(seen, ["restricted", "restricted", "denied", "fullAccess"]);
});

test("a data server that stops answering turns the calendar unavailable", async () => {
  const { calendar } = fixture({ consent: true, replies: { sources: () => { throw Object.assign(new Error("Evolution Data Server isn't installed or running in this session"), { code: "ERR_CALENDAR_UNAVAILABLE" }); } } });
  await assert.rejects(calendar("calendars")(), /Evolution Data Server/);
  assert.equal(calendar("authorizationStatus")(), "restricted");
  assert.deepEqual(await calendar("events")(START, END, []), []);
});

test("sources become calendars with Linux accounts, colors and ownership", () => {
  const calendars = calendarsFromSources(SOURCES);
  assert.deepEqual(calendars.map((c) => c.id), ["work", "personal", "holidays", "orphaned"]);
  const [work, personal, holidays, orphaned] = calendars;
  assert.deepEqual(work, { id: "work", title: "Work", color: "#62A0EA", account: "me@example.com", accountType: "calDAV", owned: true, emails: ["me@example.com"] });
  assert.equal(personal.account, "On This Computer");
  assert.equal(personal.accountType, "local");
  assert.deepEqual([holidays.account, holidays.accountType, holidays.owned, holidays.color], ["On The Web", "subscribed", false, "#FF0080"]);
  assert.equal(orphaned.color, "#8E8E93");
  assert.equal(normalizeColor("#abc"), "#AABBCC");
  assert.equal(normalizeColor("#ffff00008080"), "#FF0080");
});

test("GNOME Online Accounts sources for Google and Nextcloud list only the calendars the account has turned on", () => {
  const collection = (uid, backend, identity, calendarEnabled) => ({
    uid, calendar: false, data: {
      "Data Source": { DisplayName: identity, Enabled: "true" },
      Collection: { BackendName: backend, Identity: identity, CalendarEnabled: calendarEnabled, ContactsEnabled: "true", MailEnabled: "true" },
      "GNOME Online Accounts": { AccountId: `account_1793200000_${uid}` },
      Authentication: { Method: "OAuth2", User: identity },
    },
  });
  const child = (uid, parent, name, color, user, enabled = "true") => ({
    uid, calendar: true, data: {
      "Data Source": { DisplayName: name, Enabled: enabled, Parent: parent },
      Calendar: { BackendName: "caldav", Color: color, Selected: "true" },
      Authentication: { Host: parent === "goa-google" ? "apidata.googleusercontent.com" : "cloud.example.org", Method: "OAuth2", Port: "443", User: user },
      Offline: { StaySynchronized: "true" },
      Refresh: { Enabled: "true", IntervalMinutes: "30" },
      Security: { Method: "tls" },
      "WebDAV Backend": { AvoidIfmatch: "false", CalendarAutoSchedule: "false", DisplayName: name, EmailAddress: user, ResourcePath: `/caldav/v2/${uid}/events`, ResourceQuery: "" },
    },
  });
  const sources = [
    collection("goa-google", "google", "emma@gmail.example", "true"),
    child("google-primary", "goa-google", "emma@gmail.example", "#9fe1e7", "emma@gmail.example"),
    child("google-team", "goa-google", "Team", "#F83A22FF", "emma@gmail.example"),
    collection("goa-nextcloud", "webdav", "emma@cloud.example.org", "false"),
    child("nextcloud-personal", "goa-nextcloud", "Personal", "#0082c9", "emma"),
    collection("goa-old", "google", "old@gmail.example", "true"),
    child("old-primary", "goa-old", "old@gmail.example", "#7bd148", "old@gmail.example", "false"),
  ];
  const calendars = calendarsFromSources(sources);
  assert.deepEqual(calendars.map((c) => [c.id, c.title, c.color, c.account, c.accountType, c.owned]), [
    ["google-primary", "emma@gmail.example", "#9FE1E7", "emma@gmail.example", "calDAV", true],
    ["google-team", "Team", "#F83A22", "emma@gmail.example", "calDAV", true],
  ]);
  assert.deepEqual(calendars[0].emails, ["emma@gmail.example"]);
});

test("recurring, time-zoned, all-day, declined and cancelled events map into shared events", async () => {
  const { calendar, requests } = fixture({ consent: true });
  const calendars = await calendar("calendars")();
  assert.deepEqual(calendars[0], { id: "work", title: "Work", color: "#62A0EA", account: "me@example.com", accountType: "calDAV", owned: true });
  const events = await calendar("events")(START, END, ["work", "personal"]);
  const byTitle = Object.fromEntries(events.map((e) => [e.title, e]));
  assert.deepEqual(events.map((e) => e.title), ["Standup (moved)", "Election Day", "Design review", "Team dinner", "Lunch", "Berlin call", "Sync"]);
  const iso = (ms) => new Date(ms).toISOString();
  assert.deepEqual([iso(byTitle["Standup (moved)"].start), iso(byTitle["Standup (moved)"].end)], ["2026-11-02T15:00:00.000Z", "2026-11-02T15:30:00.000Z"]);
  assert.equal(byTitle["Standup (moved)"].occurrence, "work/standup@1793631600");
  assert.equal(byTitle["Standup (moved)"].id, "work/standup");
  assert.deepEqual([iso(byTitle["Election Day"].start), iso(byTitle["Election Day"].end), byTitle["Election Day"].allDay], ["2026-11-03T08:00:00.000Z", "2026-11-04T08:00:00.000Z", true]);
  const review = byTitle["Design review"];
  assert.equal(review.declined, true);
  assert.equal(review.cancelled, false);
  assert.equal(review.location, "Room 4, second floor");
  assert.equal(review.notes, "Agenda:\nbring notes");
  assert.deepEqual(review.organizer, { name: "Ana", email: "ana@example.com", status: "pending", me: false });
  assert.deepEqual(review.attendees, [
    { name: "Me", email: "ME@example.com", status: "declined", me: true },
    { name: "Ana", email: "ana@example.com", status: "accepted", me: false },
  ]);
  assert.equal(iso(byTitle.Lunch.start), "2026-11-04T20:00:00.000Z");
  assert.equal(byTitle.Lunch.color, "#BECEDD");
  assert.deepEqual([iso(byTitle["Team dinner"].start), iso(byTitle["Team dinner"].end), byTitle["Team dinner"].cancelled], ["2026-11-04T17:00:00.000Z", "2026-11-04T17:45:00.000Z", true]);
  assert.equal(iso(byTitle["Berlin call"].start), "2026-11-05T07:00:00.000Z");
  assert.equal(iso(byTitle.Sync.start), "2026-11-05T17:00:00.000Z");
  assert.equal(byTitle.Sync.url, "https://meet.google.com/abc-defg-hij");
  assert.ok(events.every((e) => e.calendarId === "work" ? e.color === "#62A0EA" : e.calendarId === "personal"));
  assert.deepEqual(requests.filter(([method]) => method === "ArdiaCalendar.objects").map(([, args]) => args), [[["work", "personal"], START, END]]);
  assert.deepEqual(requests.filter(([method]) => method === "ArdiaCalendar.timezones").map(([, args]) => args), [["work", ["W. Europe Standard Time"]]]);
});

test("instances keep their local time across a daylight-saving change", async () => {
  const { calendar } = fixture({ consent: true });
  await calendar("calendars")();
  const events = await calendar("events")(Date.UTC(2026, 9, 26), Date.UTC(2026, 9, 29), ["work"]);
  assert.deepEqual(events.filter((e) => e.title === "Standup").map((e) => new Date(e.start).toISOString()), ["2026-10-26T13:00:00.000Z", "2026-10-28T13:00:00.000Z"]);
});

test("hidden calendars are not read, and one failing calendar doesn't hide the others", async () => {
  const partial = fixture({ consent: true, replies: { objects: ([ids]) => ({ calendars: Object.fromEntries(ids.map((id) => [id, id === "work" ? { status: "denied", message: "the account needs signing in again" } : { status: "ok", message: "", objects: [LUNCH] }])) }) } });
  await partial.calendar("calendars")();
  const events = await partial.calendar("events")(START, END, ["personal", "work"]);
  assert.deepEqual(events.map((e) => e.title), ["Lunch"]);
  const onlyPersonal = fixture({ consent: true });
  await onlyPersonal.calendar("calendars")();
  await onlyPersonal.calendar("events")(START, END, ["personal"]);
  assert.deepEqual(onlyPersonal.requests.find(([method]) => method === "ArdiaCalendar.objects")[1][0], ["personal"]);
  const refused = fixture({ consent: true, replies: { objects: ([ids]) => ({ calendars: Object.fromEntries(ids.map((id) => [id, { status: "denied", message: "the account needs signing in again" }])) }) } });
  await refused.calendar("calendars")();
  await assert.rejects(refused.calendar("events")(START, END, ["work"]), (error) => error.code === "ERR_CALENDAR_DENIED" && /signing in again/.test(error.message));
});

test("one unreadable object or calendar doesn't blank the others, and truncation is reported", async () => {
  const deep = "BEGIN:VCALENDAR\r\n" + "BEGIN:X\r\n".repeat(120000) + "END:VCALENDAR\r\n";
  const { calendar, host } = fixture({ consent: true, replies: { objects: ([ids]) => ({ calendars: Object.fromEntries(ids.map((id) => [id, id === "work"
    ? { status: "ok", message: "", truncated: true, objects: [deep, ELECTION] }
    : { status: "ok", message: "", objects: [LUNCH, 42] }])) }) } });
  await calendar("calendars")();
  const events = await calendar("events")(START, END, ["work", "personal"]);
  assert.deepEqual(events.map((e) => e.title), ["Election Day", "Lunch"]);
  const report = linuxCalendar(host).lastRefresh();
  assert.deepEqual(report.truncatedCalendars, ["work"]);
  assert.equal(report.skippedObjects, 2);
});
