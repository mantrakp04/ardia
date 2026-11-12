import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
stub.docs.set("telemetry.json", JSON.stringify({ version: 99, sharing: true, installId: "suggestions", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: null, sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const local = await import("./localStore.ts");
const { trackSuggestionChosen } = await import("./track.ts");
client.loadChoice();

const last = () => {
  local.flushLocal();
  return stub.telemetryLocal.records().filter((r) => r.event === "suggestion_chosen").at(-1);
};

test("completed addresses report only their kind and an inline flag", () => {
  trackSuggestionChosen({ kind: "page", visited: true, url: "https://chatgpt.com/private", title: "Private title" }, true);
  const event = last();
  assert.equal(event.sent, true);
  assert.equal(event.properties.type, "history");
  assert.equal(event.properties.inline_completion, true);
  assert.doesNotMatch(JSON.stringify(event), /chatgpt|Private title|private/);
  trackSuggestionChosen({ kind: "search" });
  assert.equal(last().properties.inline_completion, false);
});

test("completed-address events stay local when sharing is off", () => {
  client.setSharing(false, "settings");
  trackSuggestionChosen({ kind: "page" }, true);
  assert.equal(last().sent, false);
  assert.deepEqual(JSON.parse(stub.docs.get("telemetry-queue.json")).events, []);
});
