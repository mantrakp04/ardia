import assert from "node:assert/strict";
import { test } from "node:test";
import { PHONE_WHATS_SENT } from "./telemetryCopy.ts";
import { CONTEXT_FIELDS, EVENT_FIELDS, RESOURCE_FIELDS, resourceFor } from "./telemetrySchema.ts";

test("What’s Sent describes every event and every field the phone can send, and nothing it doesn’t", () => {
  const described = new Set(PHONE_WHATS_SENT.flatMap((section) => section.items.flatMap((item) => item.fields)));
  const sendable = new Set([
    "uuid",
    "distinct_id",
    "timestamp",
    ...Object.keys(CONTEXT_FIELDS),
    ...RESOURCE_FIELDS,
    ...Object.keys(EVENT_FIELDS),
    ...Object.values(EVENT_FIELDS).flatMap((fields) => Object.keys(fields)),
  ]);
  assert.deepEqual([...sendable].filter((field) => !described.has(field)), []);
  assert.deepEqual([...described].filter((field) => !sendable.has(field)), []);
});

test("the envelope around each batch carries only the fields What’s Sent lists", () => {
  for (const platform of ["android", "ios"] as const) {
    assert.deepEqual(Object.keys(resourceFor({ platform, appVersion: "1.0.0", osVersion: "15", environment: "production" })).sort(), [...RESOURCE_FIELDS].sort());
  }
});

test("What’s Sent says the day’s counts are for the last day Ardia was used, which is what is sent after days away", () => {
  const usage = PHONE_WHATS_SENT.flatMap((section) => section.items).find((item) => item.fields.includes("usage_counts"))!;
  assert.match(usage.text, /last day you used Ardia/);
  assert.doesNotMatch(usage.text, /day before/);
});
