import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSessionValue, cloneSessionValue, mergeSession, shareSessionValue } from "./hostSessionMerge.ts";

test("three-way records preserve unchanged remote edits and apply local changed, added, and removed leaves", () => {
  const base = { settings: { dark: false, sidebar: true }, tabs: { a: { id: "a", url: "old-a" }, b: { id: "b", url: "old-b" } }, gone: 1 };
  const local = { settings: { dark: true, sidebar: true }, tabs: { a: { id: "a", url: "old-a" }, b: { id: "b", url: "new-b" } }, added: 2 };
  const current = { settings: { dark: false, sidebar: false }, tabs: { a: { id: "a", url: "new-a" }, b: { id: "b", url: "old-b" }, c: { id: "c" } }, gone: 1, remote: 3 };
  assert.deepEqual(mergeSession(base, local, current), {
    settings: { dark: true, sidebar: false }, tabs: { a: { id: "a", url: "new-a" }, b: { id: "b", url: "new-b" }, c: { id: "c" } }, added: 2, remote: 3,
  });
});

test("array merging uses local order, applies local deletions, retains remote additions, and deduplicates identities", () => {
  assert.deepEqual(mergeSession(["a", "b", "c"], ["c", "a", "local", "a"], ["a", "b", "c", "remote", "remote"]), ["c", "a", "local", "remote"]);
  const base = [{ id: "a", title: "old", url: "old" }, { id: "b", title: "keep" }];
  const local = [{ id: "a", title: "local", url: "old" }];
  const current = [{ id: "a", title: "old", url: "remote" }, { id: "b", title: "keep" }, { id: "c", title: "new" }];
  assert.deepEqual(mergeSession(base, local, current), [{ id: "a", title: "local", url: "remote" }, { id: "c", title: "new" }]);
});

test("closed-tab identities and recursively sorted anonymous identities agree across insertion ordering", () => {
  assert.deepEqual(mergeSession([{ tab: { id: "a", title: "old" } }], [{ tab: { id: "a", title: "local" } }], [{ tab: { id: "a", title: "old", url: "remote" } }]), [{ tab: { id: "a", title: "local", url: "remote" } }]);
  const a = { x: 1, nested: { a: 2, z: 3 } };
  const b = { nested: { z: 3, a: 2 }, x: 1 };
  assert.equal(canonicalSessionValue(a), canonicalSessionValue(b));
  assert.equal(canonicalSessionValue({ 2: "two", 10: "ten" }), '{"10":"ten","2":"two"}');
  assert.deepEqual(mergeSession([], [a], [b]), [a]);
});

test("unchanged remote deletion wins while locally edited deleted records retain complete identities", () => {
  const base = { tabs: { a: { id: "a", url: "old" } } };
  assert.deepEqual(mergeSession(base, base, { tabs: {} }), { tabs: {} });
  assert.deepEqual(mergeSession(base, { tabs: { a: { id: "a", url: "local" } } }, { tabs: {} }), { tabs: { a: { id: "a", url: "local" } } });
  assert.deepEqual(mergeSession([{ id: "a", title: "old" }], [{ id: "a", title: "old" }, { id: "b" }], []), [{ id: "b" }]);
});

test("merge skips prototype keys recursively and leaves all inputs untouched", () => {
  const poison = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"safe":{"prototype":1,"value":2}}');
  const before = JSON.stringify(poison);
  assert.deepEqual(mergeSession({}, poison, {}), { safe: { value: 2 } });
  assert.equal({}.polluted, undefined);
  assert.equal(JSON.stringify(poison), before);
});

test("structural sharing preserves unchanged table entries and transient object references", () => {
  const previous = { tabs: { a: { id: "a", url: "one" }, b: { id: "b", url: "two" } } };
  assert.equal(shareSessionValue(previous, cloneSessionValue(previous)), previous);
  const next = shareSessionValue(previous, { tabs: { a: { id: "a", url: "new" }, b: { id: "b", url: "two" } } });
  assert.notEqual(next, previous);
  assert.equal(next.tabs.b, previous.tabs.b);
});
