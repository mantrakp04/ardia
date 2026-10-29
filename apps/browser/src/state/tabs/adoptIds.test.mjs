import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { adoptKind, cloneId, pendingRestore, restoreId } from "./adoptIds.ts";

const NATIVE = new URL("../../../../../packages/ardiacore/ios/", import.meta.url);

test("each kind the native side builds or reads is one the JS parser knows", () => {
  const found = new Set();
  for (const name of readdirSync(NATIVE).filter((f) => /\.(mm|swift)$/.test(f))) {
    const source = readFileSync(new URL(name, NATIVE), "utf8");
    for (const m of source.matchAll(/offerTab:\w+ prefix:@"(\w+)"/g)) found.add(m[1]);
    if (name === "ArdiaTabParking.mm") for (const m of source.matchAll(/stringWithFormat:@"(\w+):%@"/g)) found.add(m[1]);
    for (const m of source.matchAll(/"(\w+):\\\(/g)) if (name.startsWith("WebKitHub")) found.add(m[1]);
    for (const m of source.matchAll(/\[_adoptId hasPrefix:@"(\w+):"\]/g)) found.add(m[1]);
    if (name === "ArdiaWebView+Transfer.mm") for (const m of source.matchAll(/\[kind isEqualToString:@"(\w+)"\]/g)) found.add(m[1]);
  }
  assert.ok(found.size >= 5, `found ${[...found]}`);
  for (const kind of found) assert.ok(adoptKind(`${kind}:x`), `native kind "${kind}" is unknown to adoptIds.ts`);
});

test("an adopt id is a kind and a key, and only a restore id names a pending restore", () => {
  assert.deepEqual(adoptKind(restoreId("t1")), { kind: "restore", key: "t1" });
  assert.deepEqual(adoptKind(cloneId("t:2")), { kind: "clone", key: "t:2" });
  assert.equal(adoptKind("nonsense:1"), null);
  assert.equal(adoptKind("plain"), null);
  assert.equal(pendingRestore({ page: { kind: "asleep", wake: restoreId("t1") } }), "t1");
  assert.equal(pendingRestore({ page: { kind: "asleep", wake: "tab:7" } }), undefined);
});
