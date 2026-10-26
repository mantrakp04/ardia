import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
await import("../../test-native/index.ts");
const { extensionActionChange } = await import("../../../../../packages/ardiacore/src/extensions.ts");

test("an action event keeps the engine profile name the bridge already resolved", () => {
  assert.deepEqual(extensionActionChange({ profile: "p-abc", id: "ext", kind: "action" }), { profile: "p-abc", id: "ext", kind: "action" });
  assert.deepEqual(extensionActionChange({ profile: "2", id: "ext", kind: "registry" }), { profile: "2", id: "ext", kind: "registry" });
  assert.deepEqual(extensionActionChange({ profile: "", id: "ext", kind: "sidePanel" }), { profile: "", id: "ext", kind: "sidePanel" });
  assert.equal(extensionActionChange({ profile: "", id: "ext", kind: "bogus" }).kind, "action");
});
