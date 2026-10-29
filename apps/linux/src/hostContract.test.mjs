import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callHost } from "./host.ts";
import { resolveHostModule } from "./hostModules.ts";
import { createNativeEvents } from "./hostEvents.ts";
import { hostLaunchConfig } from "./hostLaunchConfig.ts";
import { HostTab } from "./hostTab.ts";

function fixture() {
  const listeners = new Set();
  const requests = [];
  const host = {
    bootstrap: { windowId: "window", profileId: "default" },
    call: async (name, profile, args) => { requests.push({ name, profile, args }); return "null"; },
    invoke: async (method, args) => { requests.push({ method, args }); return { browserId: 7, chromeTabId: 7 }; },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { host, requests, listeners };
}

test("domain adapter preserves argument JSON and scalar, string, null and object responses", async () => {
  const { host, requests } = fixture();
  const call = resolveHostModule(host, "ArdiaHistory", "call");
  for (const reply of ['"text"', "7", "false", "null", '{"data":{"error":"valid nested value"}}']) {
    host.call = async (name, profile, args) => { requests.push({ name, profile, args }); return reply; };
    assert.equal(await call("query", "default", '{"maxUrls":5}'), reply);
    assert.deepEqual(requests.at(-1), { name: "history.query", profile: "default", args: '{"maxUrls":5}' });
  }
});

test("engine errors and bad replies reject with stable codes, profiles never retry", async () => {
  const { host } = fixture();
  for (const reply of ["", "undefined", "{bad"]) {
    host.call = async () => reply;
    await assert.rejects(callHost("history.query", "default", "{}", host), { code: "ERR_BAD_REPLY" });
  }
  host.call = async () => '{"error":"service refused"}';
  await assert.rejects(callHost("history.query", "default", "{}", host), { code: "ERR_ENGINE", message: "service refused" });
  let attempts = 0;
  host.call = async (_name, profile) => { attempts++; assert.equal(profile, "private"); throw Object.assign(new Error("Profile unavailable"), { code: "ERR_ENGINE" }); };
  await assert.rejects(callHost("history.query", "private", "{}", host), /Profile unavailable/);
  assert.equal(attempts, 1);
  await assert.rejects(callHost("history.query", null, "{}", host), /Profile must be a string/);
});

test("launch configuration is a complete synchronous copy with Linux test and prewarm safeguards", () => {
  const { host } = fixture();
  host.bootstrap.launchConfig = { dataDirectory: "/scratch/Ardia", background: true, isolated: true, testInstance: true, instance: { downloadsDir: "/downloads" }, switches: { newTabPrewarm: true, lazySidebarRows: false }, trace: ["pip"], test: { reauth: "allow" } };
  const config = resolveHostModule(host, "ArdiaApp", "launchConfig")();
  assert.equal(Object.getPrototypeOf(config), Object.prototype);
  assert.equal(config.then, undefined);
  assert.deepEqual(config, { dataDirectory: "/scratch/Ardia", background: true, isolated: true, testInstance: false, instance: { downloadsDir: "/downloads" }, switches: { newTabPrewarm: false, lazySidebarRows: false }, trace: [], test: {} });
  config.switches.lazySidebarRows = true;
  assert.equal(hostLaunchConfig(host).switches.lazySidebarRows, false);
  assert.deepEqual(Object.keys(hostLaunchConfig()).sort(), ["background", "dataDirectory", "instance", "isolated", "switches", "test", "testInstance", "trace"].sort());
});

test("domain events deliver envelopes once and listener removal survives reuse and mutation", () => {
  const events = createNativeEvents();
  const received = [];
  let first;
  first = events.add("ArdiaHistory", "history", (event) => { received.push(event); first.remove(); });
  const payload = { name: "history.changed", data: { profile: "default" } };
  const other = events.add("ArdiaBookmarks", "bookmarks", () => assert.fail("wrong domain"));
  events.emit("ArdiaHistory", "history", payload);
  events.emit("ArdiaHistory", "history", payload);
  assert.deepEqual(received, [payload]);
  const second = events.add("ArdiaHistory", "history", (event) => received.push(event));
  first.remove();
  events.emit("ArdiaHistory", "history", payload);
  assert.equal(received.length, 2);
  second.remove();
  other.remove();
  events.removeAll("ArdiaHistory");
});

test("stable tab keys carry unique claims through reclaim, buffered events and stale cleanup", async () => {
  const { host, requests, listeners } = fixture();
  let finish;
  host.invoke = (method, args) => {
    requests.push({ method, args });
    if (method === "tab.create") return new Promise((resolve) => { finish = resolve; });
    return Promise.resolve(null);
  };
  const events = [];
  const first = new HostTab(host, { key: "app-tab" }, (event) => events.push(event));
  await new Promise(setImmediate);
  for (const listener of listeners) listener("ArdiaWebView", "7", { type: "progress", progress: 0.5 });
  finish({ browserId: 7, chromeTabId: 7 });
  await first.ready;
  assert.deepEqual(events.map((e) => e.type), ["ready", "progress"]);
  const second = new HostTab(host, { key: "app-tab", adoptId: "tab:7" }, () => {});
  await new Promise(setImmediate);
  assert.deepEqual(requests.at(-1).args, { key: "app-tab", adoptId: "tab:7", claim: second.claim, previousClaim: first.claim, profile: "default", url: "about:blank" });
  finish({ browserId: 7, chromeTabId: 7 });
  await second.ready;
  await assert.rejects(first.command("reload"), /released/);
  first.dispose();
  await second.command("reload");
  assert.deepEqual(requests.at(-1).args, { id: 7, claim: second.claim, command: "reload", args: [] });
  second.dispose();
  await new Promise(setImmediate);
  assert.deepEqual(requests.at(-1), { method: "tab.release", args: { id: 7, claim: second.claim } });
  assert.equal(listeners.size, 0);
});

test("late temporary surface creation releases its private native lifetime without firing ready", async () => {
  const { host, requests } = fixture();
  let finish;
  host.invoke = (method, args) => { requests.push({ method, args }); return method === "tab.create" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(null); };
  const surface = new HostTab(host, { key: "surface", temporary: true }, () => assert.fail("disposed surface event"));
  await new Promise(setImmediate);
  surface.dispose();
  finish({ browserId: 8, chromeTabId: 8 });
  await surface.ready;
  await new Promise(setImmediate);
  assert.equal(requests[0].args.temporary, true);
  assert.deepEqual(requests.at(-1), { method: "tab.release", args: { id: 8, claim: surface.claim } });
});

test("current shared domain wrappers use the production Linux Expo adapter", () => {
  const loader = fileURLToPath(new URL("../scripts/host-contract-loader.mjs", import.meta.url));
  const fixture = fileURLToPath(new URL("../scripts/host-contract-production.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader, fixture], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /production domain wrappers, bootstrap adapter, errors and events passed/);
});
