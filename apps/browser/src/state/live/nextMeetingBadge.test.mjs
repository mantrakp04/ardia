import assert from "node:assert/strict";
import { test } from "node:test";
import { docs } from "../../test-native/index.ts";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const meeting = (id, startMin, durationMin, extra = {}) => {
  const start = NOW + startMin * MIN;
  return {
    id,
    occurrence: `${id}@${start}`,
    calendarId: "work",
    color: "#000",
    title: id,
    start,
    end: start + durationMin * MIN,
    allDay: false,
    location: "",
    notes: "",
    url: "",
    cancelled: false,
    declined: false,
    organizer: null,
    attendees: [],
    ...extra,
  };
};

const standup = meeting("standup", -5, 30);
const ended = meeting("old", -90, 30);
const savedEnd = Date.now() + 60 * MIN;
docs.set(
  "live.json",
  JSON.stringify({
    version: 1,
    calendar: { showTimeToNext: true },
    dismissedNow: { [ended.occurrence]: Date.now() - MIN, [standup.occurrence]: savedEnd, junk: "x" },
  }),
);

const { badgeText, COUNTDOWN_LEADS, DEFAULT_COUNTDOWN_LEAD, keepDismissedNow, nowBadgeEvent } = await import("./meetings.ts");
const { dismissNowBadge, live } = await import("./store.ts");

test("the countdown appears only within the chosen lead", () => {
  const events = [meeting("design", 12, 30)];
  assert.deepEqual(COUNTDOWN_LEADS, [5, 10, 15, 30, 60]);
  assert.equal(DEFAULT_COUNTDOWN_LEAD, 60);
  assert.equal(badgeText(events, NOW), "12m");
  assert.equal(badgeText(events, NOW, 60), "12m");
  assert.equal(badgeText(events, NOW, 15), "12m");
  assert.equal(badgeText(events, NOW, 10), null);
  assert.equal(badgeText(events, NOW, 5), null);
  assert.equal(badgeText(events, NOW + 7 * MIN, 5), "5m");
  assert.equal(badgeText(events, NOW + 7 * MIN - 1, 5), null);
});

test("a lead of an hour still reads 1h at the edge and nothing past it", () => {
  const events = [meeting("later", 60, 30)];
  assert.equal(badgeText(events, NOW, 60), "1h");
  assert.equal(badgeText(events, NOW - 1, 60), null);
  assert.equal(badgeText(events, NOW, 30), null);
});

test("Now shows during a meeting whatever the lead", () => {
  for (const lead of COUNTDOWN_LEADS) assert.equal(badgeText([standup], NOW, lead), "Now");
});

test("a dismissed Now hides that meeting only, and the next one still counts down", () => {
  const next = meeting("design", 4, 30);
  const dismissed = { [standup.occurrence]: standup.end };
  assert.equal(badgeText([standup, next], NOW, 60), "Now");
  assert.equal(badgeText([standup, next], NOW, 60, dismissed), "4m");
  assert.equal(badgeText([standup, next], NOW, 2, dismissed), null);
  assert.equal(badgeText([standup, next], NOW + 4 * MIN, 60, dismissed), "Now");
  assert.equal(nowBadgeEvent([standup, next], NOW + 4 * MIN, dismissed)?.id, "design");
});

test("a dismissal is per occurrence: the next occurrence of a recurring meeting badges again", () => {
  const today = meeting("weekly", -5, 30);
  const nextWeek = meeting("weekly", 7 * 24 * 60 - 5, 30);
  const dismissed = { [today.occurrence]: today.end };
  assert.equal(badgeText([today], NOW, 60, dismissed), null);
  assert.equal(badgeText([nextWeek], NOW + 7 * 24 * 60 * MIN, 60, dismissed), "Now");
});

test("overlapping meetings: dismissing the newest leaves the other's Now", () => {
  const long = meeting("workshop", -60, 120);
  const dismissed = { [standup.occurrence]: standup.end };
  assert.equal(nowBadgeEvent([long, standup], NOW)?.id, "standup");
  assert.equal(nowBadgeEvent([long, standup], NOW, dismissed)?.id, "workshop");
  assert.equal(badgeText([long, standup], NOW, 60, dismissed), "Now");
});

test("there is nothing to dismiss before a meeting starts", () => {
  assert.equal(nowBadgeEvent([meeting("design", 3, 30)], NOW), null);
  assert.equal(nowBadgeEvent([meeting("allday", -60, 24 * 60, { allDay: true })], NOW), null);
});

test("saved dismissals last until their meeting ends", () => {
  assert.deepEqual(keepDismissedNow({ a: NOW + 1, b: NOW, c: NOW - 1, d: "x" }, NOW), { a: NOW + 1 });
  assert.deepEqual(keepDismissedNow(null, NOW), {});
  assert.deepEqual(keepDismissedNow(["a"], NOW), {});
  assert.deepEqual(live().dismissedNow, { [standup.occurrence]: savedEnd });
});

test("dismissing records the occurrence with its end and drops ended ones", () => {
  const design = meeting("design", -1, 30);
  dismissNowBadge(design, NOW);
  assert.equal(live().dismissedNow[design.occurrence], design.end);
  dismissNowBadge(meeting("late", -1, 600), design.end + 1);
  assert.equal(live().dismissedNow[design.occurrence], undefined);
});

test("the countdown lead defaults to an hour for settings saved before it existed", () => {
  assert.equal(live().calendar.countdownLead, 60);
  assert.equal(live().calendar.showTimeToNext, true);
});
