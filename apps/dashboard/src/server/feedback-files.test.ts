import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackFileBases, fetchFeedbackFile } from "./feedback-files.ts";

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

const BASES = ["http://reports.internal:8888/buckets/feedback/", "http://replays.internal:8888/buckets/feedback/"];

function stores(answers: Array<number | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string>; signal: AbortSignal | null | undefined }> = [];
  const send: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, signal: init?.signal });
    const answer = answers[calls.length - 1];
    if (answer instanceof Error) throw answer;
    return new Response(answer === 200 || answer === 206 ? "bytes" : "", { status: answer });
  };
  return { calls, send };
}

const ask = (send: typeof fetch, range: string | null = null, signal = new AbortController().signal) =>
  fetchFeedbackFile(BASES, "FB-ABCD", "recording.mp4", { headers: { Authorization: "Bearer t" }, range, signal }, send);

test("a file the report store lacks is read from the replay store", async () => {
  const { calls, send } = stores([404, 200]);
  const found = await ask(send);
  assert.equal(found?.status, 200);
  assert.equal(await found?.text(), "bytes");
  assert.deepEqual(calls.map((call) => call.url), BASES.map((base) => `${base}FB-ABCD/recording.mp4`));
});

test("a file the report store has is not looked for in the replay store", async () => {
  const { calls, send } = stores([200, 200]);
  assert.equal((await ask(send))?.status, 200);
  assert.deepEqual(calls.map((call) => call.url), [`${BASES[0]}FB-ABCD/recording.mp4`]);
});

test("a file that neither store has answers 404 after both were asked", async () => {
  const { calls, send } = stores([404, 404]);
  assert.equal((await ask(send))?.status, 404);
  assert.equal(calls.length, 2);
});

test("an error from the report store stops the search instead of reading an older copy", async () => {
  const { calls, send } = stores([500, 200]);
  assert.equal((await ask(send))?.status, 500);
  assert.equal(calls.length, 1);
});

test("a store that cannot be reached stops the search", async () => {
  const { calls, send } = stores([new Error("connect ECONNREFUSED"), 200]);
  await assert.rejects(ask(send), /ECONNREFUSED/);
  assert.equal(calls.length, 1);
});

test("the Range header and the credentials reach the request to the fallback store", async () => {
  const { calls, send } = stores([404, 206]);
  const found = await ask(send, "bytes=0-9");
  assert.equal(found?.status, 206);
  const sent = { Authorization: "Bearer t", Range: "bytes=0-9" };
  assert.deepEqual(calls.map((call) => call.headers), [sent, sent]);
});

test("no Range header is sent when the viewer sent none", async () => {
  const { calls, send } = stores([404, 200]);
  await ask(send);
  assert.deepEqual(calls.map((call) => call.headers), [{ Authorization: "Bearer t" }, { Authorization: "Bearer t" }]);
});

test("both requests carry the caller's abort signal", async () => {
  const { calls, send } = stores([404, 200]);
  const signal = new AbortController().signal;
  await ask(send, null, signal);
  assert.deepEqual(calls.map((call) => call.signal), [signal, signal]);
});

test("a name or id is encoded into one path segment", async () => {
  const { calls, send } = stores([200]);
  await fetchFeedbackFile(BASES, "FB-ABCD", "a b.txt", { headers: {}, range: null, signal: new AbortController().signal }, send);
  assert.deepEqual(calls.map((call) => call.url), [`${BASES[0]}FB-ABCD/a%20b.txt`]);
});

test("nothing configured finds nothing", async () => {
  const { calls, send } = stores([]);
  assert.equal(await fetchFeedbackFile([], "FB-ABCD", "x.txt", { headers: {}, range: null, signal: new AbortController().signal }, send), undefined);
  assert.equal(calls.length, 0);
});
