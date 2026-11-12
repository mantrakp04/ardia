import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackFileBases } from "./feedback-files.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];

test("reports are read from their own store first, then from the replay store they used to share", () => {
  assert.deepEqual(feedbackFileBases(env({ FEEDBACK_OBJECTS_HOST: "reports.internal", REPLAYS_HOST: "replays.internal" })), [
    "http://reports.internal:8888/buckets/feedback/",
    "http://replays.internal:8888/buckets/feedback/",
  ]);
});

test("an explicit address replaces the report store's host and keeps the old location as the fallback", () => {
  assert.deepEqual(feedbackFileBases(env({ FEEDBACK_FILES_URL: "https://files.example/buckets/feedback", FEEDBACK_OBJECTS_HOST: "reports.internal", REPLAYS_HOST: "replays.internal" })), [
    "https://files.example/buckets/feedback/",
    "http://replays.internal:8888/buckets/feedback/",
  ]);
});

test("the replay address gives the old location when it names the replays bucket", () => {
  assert.deepEqual(feedbackFileBases(env({ REPLAYS_URL: "https://store.example/buckets/replays/", REPLAYS_HOST: "replays.internal" })), ["https://store.example/buckets/feedback/"]);
  assert.deepEqual(feedbackFileBases(env({ REPLAYS_URL: "https://store.example/elsewhere/", REPLAYS_HOST: "replays.internal" })), ["http://replays.internal:8888/buckets/feedback/"]);
});

test("one location is listed once", () => {
  assert.deepEqual(feedbackFileBases(env({ FEEDBACK_OBJECTS_HOST: "same.internal", REPLAYS_HOST: "same.internal" })), ["http://same.internal:8888/buckets/feedback/"]);
});

test("nothing is configured", () => {
  assert.deepEqual(feedbackFileBases(env({})), []);
});
