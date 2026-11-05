import assert from "node:assert/strict";
import { test } from "node:test";

const stub = await import("../../test-native/index.ts");
const { reloadHooks, useHookRules, activeHook } = await import("./hookRules.ts");
const { startDecideHooks } = await import("./decideHooks.ts");

const reported = () => [stub.systemSignals.holdsIncomingLinks, stub.systemSignals.hooksStamp];

function serve(text, stamp) {
  if (text === undefined) stub.configFolder.files.delete("hooks.json");
  else stub.configFolder.files.set("hooks.json", text);
  stub.configFolder.stamps.set("hooks.json", stamp);
}

test("the link policy goes to native with the stamp of the hooks.json read its rules came from", () => {
  serve(JSON.stringify({ hooks: [] }), "A");
  startDecideHooks();
  assert.deepEqual(reported(), [false, "A"]);

  serve(JSON.stringify({ hooks: [] }), "B");
  reloadHooks();
  assert.deepEqual(reported(), [false, "B"], "a new version with the same rules is still reported");

  serve("{ not json", "C");
  reloadHooks();
  assert.deepEqual(reported(), [false, "B"], "a version that didn't load never takes the stamp");

  serve(JSON.stringify({ hooks: [{ name: "drop-x", on: ["link.opening"], match: ["https://x.example/*"], drop: true }] }), "D");
  reloadHooks();
  const hook = useHookRules.getState().hooks[0];
  assert.deepEqual(reported(), [activeHook(hook), "D"]);

  serve(undefined, "missing");
  reloadHooks();
  assert.deepEqual(reported(), [false, "missing"]);
});
