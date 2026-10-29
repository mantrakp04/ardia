import assert from "node:assert/strict";
import { test } from "node:test";
import "../../test-native/index.ts";

const { isGoogleCalendarId, mapGoogleCalendar, mapGoogleEvent } = await import("./googleCalendar.ts");
const { joinLink } = await import("./meetings.ts");

const work = mapGoogleCalendar({ id: "me@example.com", summary: "me@example.com", summaryOverride: "Work", backgroundColor: "#16a765", accessRole: "owner" }, "me@example.com");

test("a Google calendar keeps its own id space, title override and colour", () => {
  assert.deepEqual(work, { id: "gcal:me@example.com", title: "Work", color: "#16a765", account: "me@example.com", accountType: "other", owned: true });
  assert.equal(isGoogleCalendarId(work.id), true);
  assert.equal(isGoogleCalendarId("4F1C-EVENTKIT"), false);
  assert.equal(mapGoogleCalendar({ id: "team", accessRole: "reader" }, "me@example.com").owned, false);
});

test("a timed instance of a recurring event maps to one occurrence with its Meet link", () => {
  const event = mapGoogleEvent(
    {
      id: "standup_20261029T150000Z",
      recurringEventId: "standup",
      summary: "Standup",
      start: { dateTime: "2026-10-29T15:00:00Z" },
      end: { dateTime: "2026-10-29T15:15:00Z" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      organizer: { email: "lead@example.com", displayName: "Lead" },
      attendees: [
        { email: "me@example.com", self: true, responseStatus: "needsAction" },
        { email: "lead@example.com", displayName: "Lead", responseStatus: "accepted" },
        { email: "room@resource.calendar.google.com", resource: true, responseStatus: "accepted" },
      ],
    },
    work,
  );
  const start = Date.parse("2026-10-29T15:00:00Z");
  assert.equal(event.id, "gcal:me@example.com/standup");
  assert.equal(event.occurrence, `gcal:me@example.com/standup@${start}`);
  assert.equal(event.end - event.start, 15 * 60_000);
  assert.equal(event.allDay, false);
  assert.equal(event.calendarId, work.id);
  assert.equal(event.color, work.color);
  assert.equal(event.declined, false);
  assert.deepEqual(event.organizer, { name: "Lead", email: "lead@example.com", status: "accepted", me: false });
  assert.deepEqual(
    event.attendees.map((a) => [a.email, a.status, a.me]),
    [
      ["me@example.com", "pending", true],
      ["lead@example.com", "accepted", false],
    ],
  );
  assert.deepEqual(joinLink(event), { url: "https://meet.google.com/abc-defg-hij", provider: "meet" });
});

test("a Zoom link in the description and a declined invite carry over", () => {
  const event = mapGoogleEvent(
    {
      id: "sync",
      summary: "Sync",
      description: 'Join: <a href="https://zoom.us/j/123456789">https://zoom.us/j/123456789</a>',
      start: { dateTime: "2026-10-29T10:00:00-07:00" },
      end: { dateTime: "2026-10-29T10:30:00-07:00" },
      attendees: [{ email: "me@example.com", self: true, responseStatus: "declined" }],
    },
    work,
  );
  assert.equal(event.declined, true);
  assert.equal(joinLink(event)?.provider, "zoom");
});

test("all-day events start and end at local midnight", () => {
  const event = mapGoogleEvent({ id: "trip", status: "confirmed", start: { date: "2026-10-29" }, end: { date: "2026-10-30" } }, work);
  assert.equal(event.allDay, true);
  assert.equal(event.start, new Date(2026, 9, 29).getTime());
  assert.equal(event.end, new Date(2026, 9, 30).getTime());
  assert.equal(event.title, "");
});

test("cancelled events are marked and events without times are dropped", () => {
  assert.equal(mapGoogleEvent({ id: "x", status: "cancelled", start: { dateTime: "2026-10-29T10:00:00Z" }, end: { dateTime: "2026-10-29T11:00:00Z" } }, work).cancelled, true);
  assert.equal(mapGoogleEvent({ id: "y", status: "cancelled" }, work), null);
  assert.equal(mapGoogleEvent({ id: "z", start: { dateTime: "nope" }, end: { dateTime: "nope" } }, work), null);
});
