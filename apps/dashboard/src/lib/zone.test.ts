import assert from "node:assert/strict";
import test from "node:test";
import { windowFor } from "./range.ts";
import { addDays, parseZone, startOfDay, startOfHour } from "./zone.ts";

const LA = "America/Los_Angeles";

test("local midnight and hour in a zone west of UTC", () => {
  const at = Date.UTC(2026, 10, 11, 22, 57);
  assert.equal(startOfDay(at, LA), Date.UTC(2026, 10, 11, 8));
  assert.equal(startOfHour(at, LA), Date.UTC(2026, 10, 11, 22));
  assert.equal(startOfDay(Date.UTC(2026, 10, 12, 3), LA), Date.UTC(2026, 10, 11, 8));
});

test("half-hour zones floor to their own hour", () => {
  assert.equal(startOfHour(Date.UTC(2026, 10, 11, 10, 10), "Asia/Kolkata"), Date.UTC(2026, 10, 11, 9, 30));
  assert.equal(startOfDay(Date.UTC(2026, 10, 11, 10), "Asia/Kolkata"), Date.UTC(2026, 10, 10, 18, 30));
});

test("days across a DST change stay on local midnight", () => {
  const before = startOfDay(Date.UTC(2026, 10, 1, 6), LA);
  assert.equal(before, Date.UTC(2026, 9, 31, 7));
  assert.equal(addDays(before, 1, LA), Date.UTC(2026, 10, 1, 7));
  assert.equal(addDays(before, 2, LA), Date.UTC(2026, 10, 2, 8));
});

test("windows bucket by the viewer's day and hour", () => {
  const at = Date.UTC(2026, 10, 11, 22, 57);
  const week = windowFor("7d", LA, at);
  assert.equal(week.buckets.length, 7);
  assert.equal(week.buckets[6], Date.UTC(2026, 10, 11, 8));
  assert.equal(week.buckets[0], Date.UTC(2026, 10, 5, 8));
  const day = windowFor("24h", LA, Date.UTC(2026, 10, 11, 22, 40));
  assert.equal(day.buckets.length, 24);
  assert.equal(day.buckets[23], Date.UTC(2026, 10, 11, 22));
});

test("UTC windows are unchanged", () => {
  const at = Date.UTC(2026, 10, 11, 22, 57);
  const w = windowFor("7d", "UTC", at);
  assert.equal(w.buckets[0], Date.UTC(2026, 10, 5));
  assert.equal(w.start, Date.UTC(2026, 10, 5));
});

test("zones from the client are validated", () => {
  assert.equal(parseZone("America/Los_Angeles"), LA);
  assert.equal(parseZone("Not/AZone"), "UTC");
  assert.equal(parseZone("UTC') OR 1=1 --"), "UTC");
  assert.equal(parseZone(42), "UTC");
});
