import assert from "node:assert/strict";
import test from "node:test";
import { HostTab } from "./hostTab.ts";

function nativePolicy() {
  let active = "";
  let failure;
  let pending;
  const requests = [];
  const listeners = new Set();
  const host = {
    bootstrap: { windowId: "owned", profileId: "default" },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invoke(method, args) {
      requests.push({ method, args });
      if (method === "tab.create") {
        if (pending) await pending;
        if (failure) { const error = failure; failure = undefined; throw error; }
        if (active && args.previousClaim !== active) throw new Error("active native owner");
        active = args.claim;
        return { browserId: 7, chromeTabId: 7 };
      }
      if (method === "tab.release") {
        if (args.claim !== active) throw new Error("stale native release");
        active = "";
      }
      if (method === "tab.command" && args.claim !== active) throw new Error("stale native command");
      return null;
    },
  };
  return {
    host, requests, listeners, active: () => active,
    fail() { failure = new Error("replacement failed"); },
    hold() { let resolve; pending = new Promise((done) => { resolve = done; }); return () => { pending = undefined; resolve(); }; },
  };
}

const settle = () => new Promise(setImmediate);

test("failed replacement retains predecessor ownership and permits a later retry", async () => {
  const f = nativePolicy();
  const a = new HostTab(f.host, { key: "stable" }, () => {});
  await a.ready;
  f.fail();
  const b = new HostTab(f.host, { key: "stable" }, () => {});
  await assert.rejects(b.ready, /replacement failed/);
  await a.command("reload");
  a.dispose();
  await settle();
  assert.equal(f.active(), "");
  const c = new HostTab(f.host, { key: "stable" }, () => {});
  await c.ready;
  c.dispose();
  await settle();
  assert.equal(f.active(), "");
});

test("predecessor disposal during failed replacement releases the original native claim", async () => {
  const f = nativePolicy();
  const a = new HostTab(f.host, { key: "stable" }, () => {});
  await a.ready;
  const finish = f.hold();
  f.fail();
  const b = new HostTab(f.host, { key: "stable" }, () => {});
  await settle();
  a.dispose();
  finish();
  await assert.rejects(b.ready, /replacement failed/);
  await settle();
  assert.equal(f.active(), "");
  const c = new HostTab(f.host, { key: "stable" }, () => {});
  await c.ready;
  c.dispose();
  await settle();
  assert.equal(f.active(), "");
});

test("successful replacement cannot be released by its disposed predecessor", async () => {
  const f = nativePolicy();
  const a = new HostTab(f.host, { key: "stable" }, () => {});
  await a.ready;
  const finish = f.hold();
  const b = new HostTab(f.host, { key: "stable" }, () => {});
  await settle();
  a.dispose();
  finish();
  await b.ready;
  await b.command("reload");
  assert.equal(f.active(), b.claim);
  assert.equal(f.requests.filter((r) => r.method === "tab.release").length, 0);
  b.dispose();
  await settle();
  assert.equal(f.active(), "");
});

test("concurrent replacements serialize native claims and recover after a failed middle mount", async () => {
  const f = nativePolicy();
  const a = new HostTab(f.host, { key: "stable" }, () => {});
  await a.ready;
  const finish = f.hold();
  f.fail();
  const b = new HostTab(f.host, { key: "stable" }, () => {});
  const c = new HostTab(f.host, { key: "stable" }, () => {});
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
  assert.equal(f.active(), "");
});

test("pending failed replacements preserve predecessor commands and ordered release", async () => {
  const f = nativePolicy();
  const a = new HostTab(f.host, { key: "stable" }, () => {});
  await a.ready;
  const finish = f.hold();
  f.fail();
  const b = new HostTab(f.host, { key: "stable" }, () => {});
  const rejected = assert.rejects(b.ready, /replacement failed/);
  const command = a.command("reload");
  await settle();
  finish();
  await rejected;
  await command;
  assert.equal(f.active(), a.claim);
  a.dispose();
  await settle();
  assert.equal(f.active(), "");
});

test("late successful creation releases only the final disposed replacement", async () => {
  const f = nativePolicy();
  const a = new HostTab(f.host, { key: "stable" }, () => {});
  await a.ready;
  const finish = f.hold();
  const b = new HostTab(f.host, { key: "stable" }, () => {});
  await settle();
  a.dispose();
  b.dispose();
  finish();
  await b.ready;
  await settle();
  assert.equal(f.active(), "");
  assert.deepEqual(f.requests.filter((r) => r.method === "tab.release").map((r) => r.args.claim), [b.claim]);
  const c = new HostTab(f.host, { key: "stable" }, () => {});
  await c.ready;
  c.dispose();
  await settle();
  assert.equal(f.active(), "");
});
