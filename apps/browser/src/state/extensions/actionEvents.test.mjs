import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { emitEvent } = await import("../../test-native/index.ts");
const { onExtensionActionChanged } = await import("../../platform/extensions.ts");

test("an action event keeps the engine profile name the bridge already resolved", () => {
  const heard = [];
  const subscription = onExtensionActionChanged((change) => heard.push(change));
  const sent = [
    { profile: "p-abc", id: "ext", kind: "action" },
    { profile: "2", id: "ext", kind: "registry" },
    { profile: "", id: "ext", kind: "sidePanel" },
  ];
  for (const change of sent) emitEvent("extensions.action", change);
  subscription.remove();
  assert.deepEqual(heard, sent);
});
