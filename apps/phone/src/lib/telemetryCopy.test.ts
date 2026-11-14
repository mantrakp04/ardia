import assert from "node:assert/strict";
import { test } from "node:test";
import { PHONE_WHATS_SENT } from "./telemetryCopy.ts";
import { CONTEXT_FIELDS, EVENT_FIELDS } from "./telemetrySchema.ts";

test("What’s Sent describes every event and every field the phone can send, and nothing it doesn’t", () => {
  const described = new Set(PHONE_WHATS_SENT.flatMap((section) => section.items.flatMap((item) => item.fields)));
  const sendable = new Set([
    "uuid",
    "distinct_id",
    "timestamp",
    ...Object.keys(CONTEXT_FIELDS),
    ...Object.keys(EVENT_FIELDS),
    ...Object.values(EVENT_FIELDS).flatMap((fields) => Object.keys(fields)),
  ]);
  assert.deepEqual([...sendable].filter((field) => !described.has(field)), []);
  assert.deepEqual([...described].filter((field) => !sendable.has(field)), []);
});
