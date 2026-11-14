import assert from "node:assert/strict";
import test from "node:test";
import { historyCuts, receiveTabs, type IncomingTab } from "./received.ts";
import { emptyTabs, openTab } from "./tabsState.ts";

const incoming = (key: string, url: string, sentAt: number): IncomingTab => ({ key, url, title: `Sent ${key}`, fromDevice: "Mac Studio", sentAt, profileSyncId: "work" });

test("tabs a Mac sent open once each, in the order they were sent, without taking the front", () => {
  const start = openTab(emptyTabs(), { url: "https://front.example/", origin: "typed", isPrivate: false }, 1, "front").change.data;
  let n = 0;
  const { change, opened } = receiveTabs(
    start,
    [incoming("b", "https://b.example/", 20), incoming("a", "https://a.example/", 10), incoming("bad", "javascript:alert(1)", 30)],
    new Set(),
    50,
    () => `r${++n}`,
  );
  assert.deepEqual(
    opened.map((t) => t.url),
    ["https://a.example/", "https://b.example/"],
  );
  assert.equal(change.data.selectedId, "front");
  assert.equal(opened[0]!.origin, "sent");
  assert.equal(opened[0]!.receivedKey, "a");
  assert.equal(opened[0]!.receivedFromDevice, "Mac Studio");
  assert.equal(opened[0]!.profileSyncId, "work");
  assert.equal(opened[0]!.title, "Sent a");
  assert.ok(change.put.some((t) => t.id === opened[1]!.id));
  const again = receiveTabs(change.data, [incoming("a", "https://a.example/", 10)], new Set(), 60, () => "dup");
  assert.deepEqual(again.opened, []);
  const archivedKey = receiveTabs(start, [incoming("z", "https://z.example/", 1)], new Set(["z"]), 60, () => "z1");
  assert.deepEqual(archivedKey.opened, []);
});

test("history the Mac removed is cut from its profile, and from unassigned visits when it says so", () => {
  assert.deepEqual(historyCuts({ profileSyncId: "work", urls: ["https://a/"], includesUnassigned: false }), [{ urls: ["https://a/"], profileSyncId: "work" }]);
  assert.deepEqual(historyCuts({ profileSyncId: "work", urls: ["https://a/"], includesUnassigned: true }), [
    { urls: ["https://a/"], profileSyncId: "work" },
    { urls: ["https://a/"], profileSyncId: null },
  ]);
  assert.deepEqual(historyCuts({ profileSyncId: null, urls: ["https://a/"], includesUnassigned: true }), [{ urls: ["https://a/"], profileSyncId: null }]);
});
