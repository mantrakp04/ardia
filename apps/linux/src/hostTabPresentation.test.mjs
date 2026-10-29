import assert from "node:assert/strict";
import test from "node:test";
import { HostTab } from "./hostTab.ts";

function fixture() {
  const active = new Map();
  const requests = [];
  const applied = [];
  let blockCreate;
  let blockBatch;
  let failed = false;
  const host = {
    bootstrap: { profileId: "default" },
    onEvent: () => () => {},
    async invoke(method, args) {
      requests.push({ method, args });
      if (method === "tab.create") {
        const id = args.key === "replaced" ? 7 : 8;
        if (active.has(id) && blockCreate) await blockCreate;
        if (active.has(id) && failed) { failed = false; throw new Error("replacement failed"); }
        if (active.has(id) && active.get(id) !== args.previousClaim) throw new Error("invalid predecessor");
        active.set(id, args.claim);
        return { browserId: id, chromeTabId: id };
      }
      if (method === "tab.presentations") {
        for (const item of args.tabs) if (active.get(item.id) !== item.claim) throw new Error("stale batch claim");
        applied.push(...args.tabs);
        if (blockBatch) await blockBatch;
      }
      if (method === "tab.release" && active.get(args.id) === args.claim) active.delete(args.id);
      return null;
    },
  };
  return {
    host, requests, applied, active,
    holdCreate() { let finish; blockCreate = new Promise((resolve) => { finish = resolve; }); return (fail = false) => { failed = fail; blockCreate = undefined; finish(); }; },
    holdBatch() { let finish; blockBatch = new Promise((resolve) => { finish = resolve; }); return () => { blockBatch = undefined; finish(); }; },
  };
}
const settle = () => new Promise(setImmediate);

async function panes(f) {
  const a = new HostTab(f.host, { key: "replaced" }, () => {});
  const d = new HostTab(f.host, { key: "other" }, () => {});
  await Promise.all([a.ready, d.ready]);
  return { a, d };
}

test("presentation batches cannot be overtaken by a replacement after one microtask", async () => {
  const f = fixture();
  const { a, d } = await panes(f);
  const updates = [a.presentation(false), d.presentation(true)];
  await Promise.resolve();
  const b = new HostTab(f.host, { key: "replaced" }, () => {});
  await Promise.all([...updates, b.ready]);
  assert.ok(f.applied.some((item) => item.id === 8 && item.visible));
  assert.ok(f.applied.some((item) => item.id === 7 && item.claim === a.claim));
  assert.equal(f.requests.filter((r) => r.method === "tab.presentations").length, 1);
  a.dispose(); b.dispose(); d.dispose();
  await settle();
});

test("an unrelated pane progresses while a replacement is pending and then fails", async () => {
  const f = fixture();
  const { a, d } = await panes(f);
  const finish = f.holdCreate();
  const b = new HostTab(f.host, { key: "replaced" }, () => {});
  const rejected = assert.rejects(b.ready, /replacement failed/);
  const pending = a.presentation(false);
  await d.presentation(true);
  assert.ok(f.applied.some((item) => item.id === 8 && item.visible));
  assert.ok(!f.applied.some((item) => item.id === 7));
  finish(true);
  await rejected;
  await pending;
  assert.ok(f.applied.some((item) => item.id === 7 && item.claim === a.claim));
  a.dispose(); b.dispose(); d.dispose();
  await settle();
});

test("multikey batches reserve ownership through their native reply and release both queues", async () => {
  const f = fixture();
  const { a, d } = await panes(f);
  const finish = f.holdBatch();
  const updates = [a.presentation(false), d.presentation(true)];
  await settle();
  assert.equal(f.requests.filter((r) => r.method === "tab.presentations").length, 1);
  const b = new HostTab(f.host, { key: "replaced" }, () => {});
  const e = new HostTab(f.host, { key: "other" }, () => {});
  const next = [b.presentation(true), e.presentation(false)];
  await settle();
  assert.equal(f.requests.filter((r) => r.method === "tab.create").length, 2);
  finish();
  await Promise.all([...updates, b.ready, e.ready, ...next]);
  assert.ok(f.applied.some((item) => item.claim === b.claim && item.visible));
  assert.ok(f.applied.some((item) => item.claim === e.claim && !item.visible));
  a.dispose(); b.dispose(); d.dispose(); e.dispose();
  await settle();
  assert.equal(f.active.size, 0);
});

test("disposing one queued pane leaves the other presentation valid", async () => {
  const f = fixture();
  const { a, d } = await panes(f);
  const updates = [a.presentation(false), d.presentation(true)];
  a.dispose();
  const b = new HostTab(f.host, { key: "replaced" }, () => {});
  await Promise.all([...updates, b.ready]);
  assert.ok(f.applied.some((item) => item.id === 8 && item.visible));
  assert.ok(!f.applied.some((item) => item.claim === a.claim));
  b.dispose(); d.dispose();
  await settle();
});

test("a failed mount cannot release the queue ahead of a later pending replacement", async () => {
  const f = fixture();
  const { a, d } = await panes(f);
  const fail = f.holdCreate();
  const b = new HostTab(f.host, { key: "replaced" }, () => {});
  const rejected = assert.rejects(b.ready, /replacement failed/);
  await settle();
  fail(true);
  await rejected;
  const finish = f.holdCreate();
  const c = new HostTab(f.host, { key: "replaced" }, () => {});
  await settle();
  const invalid = assert.rejects(b.presentation(false), /replacement failed/);
  const e = new HostTab(f.host, { key: "replaced" }, () => {});
  await settle();
  assert.equal(f.requests.filter((r) => r.method === "tab.create").length, 4);
  finish();
  await Promise.all([c.ready, invalid, e.ready]);
  assert.equal(f.active.get(7), e.claim);
  a.dispose(); b.dispose(); c.dispose(); d.dispose(); e.dispose();
  await settle();
  assert.equal(f.active.size, 0);
});
