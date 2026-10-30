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
    bootstrap: { windowId: "owned", profileId: "default" },
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
      if (method === "tab.command" && active.get(args.id) !== args.claim) throw new Error("stale native command");
      if (method === "tab.release") {
        if (active.get(args.id) !== args.claim) throw new Error("stale native release");
        active.delete(args.id);
      }
      return null;
    },
  };
  return {
    host, requests, applied, active,
    fail() { failed = true; },
    holdCreate() { let finish; blockCreate = new Promise((resolve) => { finish = resolve; }); return () => { blockCreate = undefined; finish(); }; },
    holdBatch() { let finish; blockBatch = new Promise((resolve) => { finish = resolve; }); return () => { blockBatch = undefined; finish(); }; },
  };
}
const settle = () => new Promise(setImmediate);
const tab = (f, key = "replaced") => new HostTab(f.host, { key }, () => {});
const releases = (f) => f.requests.filter((r) => r.method === "tab.release").map((r) => r.args.claim);

async function panes(f) {
  const a = tab(f);
  const d = tab(f, "other");
  await Promise.all([a.ready, d.ready]);
  return { a, d };
}

test("a failed replacement keeps the predecessor's queued commands and ownership, and permits a later retry", async () => {
  const f = fixture();
  const a = tab(f);
  await a.ready;
  const finish = f.holdCreate();
  f.fail();
  const b = tab(f);
  const rejected = assert.rejects(b.ready, /replacement failed/);
  const command = a.command("reload");
  await settle();
  finish();
  await rejected;
  await command;
  assert.equal(f.active.get(7), a.claim);
  a.dispose();
  await settle();
  const c = tab(f);
  await c.ready;
  c.dispose();
  await settle();
  assert.equal(f.active.size, 0);
});

test("predecessor disposal during failed replacement releases the original native claim", async () => {
  const f = fixture();
  const a = tab(f);
  await a.ready;
  const finish = f.holdCreate();
  f.fail();
  const b = tab(f);
  await settle();
  a.dispose();
  finish();
  await assert.rejects(b.ready, /replacement failed/);
  await settle();
  assert.deepEqual(releases(f), [a.claim]);
  assert.equal(f.active.size, 0);
});

test("successful replacement cannot be released by its disposed predecessor", async () => {
  const f = fixture();
  const a = tab(f);
  await a.ready;
  const finish = f.holdCreate();
  const b = tab(f);
  await settle();
  a.dispose();
  finish();
  await b.ready;
  await b.command("reload");
  assert.equal(f.active.get(7), b.claim);
  assert.deepEqual(releases(f), []);
  b.dispose();
  await settle();
  assert.equal(f.active.size, 0);
});

test("concurrent replacements serialize native claims and recover after a failed middle mount", async () => {
  const f = fixture();
  const a = tab(f);
  await a.ready;
  const finish = f.holdCreate();
  f.fail();
  const b = tab(f);
  const c = tab(f);
  const rejected = assert.rejects(b.ready, /replacement failed/);
  await settle();
  finish();
  await rejected;
  await c.ready;
  await assert.rejects(a.command("reload"), /released/);
  a.dispose();
  b.dispose();
  await c.command("reload");
  c.dispose();
  await settle();
  assert.equal(f.active.size, 0);
});

test("late successful creation releases only the final disposed replacement", async () => {
  const f = fixture();
  const a = tab(f);
  await a.ready;
  const finish = f.holdCreate();
  const b = tab(f);
  await settle();
  a.dispose();
  b.dispose();
  finish();
  await b.ready;
  await settle();
  assert.equal(f.active.size, 0);
  assert.deepEqual(releases(f), [b.claim]);
});

test("presentation batches cannot be overtaken by a replacement after one microtask", async () => {
  const f = fixture();
  const { a, d } = await panes(f);
  const updates = [a.presentation(false), d.presentation(true)];
  await Promise.resolve();
  const b = tab(f);
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
  f.fail();
  const b = tab(f);
  const rejected = assert.rejects(b.ready, /replacement failed/);
  const pending = a.presentation(false);
  await d.presentation(true);
  assert.ok(f.applied.some((item) => item.id === 8 && item.visible));
  assert.ok(!f.applied.some((item) => item.id === 7));
  finish();
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
  const b = tab(f);
  const e = tab(f, "other");
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
  const b = tab(f);
  await Promise.all([...updates, b.ready]);
  assert.ok(f.applied.some((item) => item.id === 8 && item.visible));
  assert.ok(!f.applied.some((item) => item.claim === a.claim));
  b.dispose(); d.dispose();
  await settle();
});
