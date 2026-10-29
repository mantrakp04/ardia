import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const bootstrap = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/bootstrap.js", import.meta.url), "utf8");
const hostModules = new URL("./hostModules.ts", import.meta.url).href;
const hostEvents = new URL("./hostEvents.ts", import.meta.url).href;

const nativeShim = `data:text/javascript,${encodeURIComponent(`
import { resolveHostModule } from ${JSON.stringify(hostModules)};
import { createNativeEvents } from ${JSON.stringify(hostEvents)};
const events = createNativeEvents();
globalThis.__siteControlsHost.onEvent((module, event, payload) => events.emit(module, event, payload));
export function requireNativeModule(name) {
  return new Proxy({}, { get(_target, key) {
    if (key === "addListener") return (event, listener) => events.add(name, event, listener);
    return resolveHostModule(globalThis.__siteControlsHost, name, key);
  } });
}
export function requireNativeViewManager() {
  return () => null;
}
`)}`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-modules-core" && context.parentURL?.includes("/packages/ardiacore/src/")) return { url: nativeShim, shortCircuit: true };
    return next(specifier, context);
  },
});

const calls = [];
const replies = new Map();
const context = {
  location: { protocol: "chrome:", hostname: "ardia" },
  crypto: { randomUUID },
  __ardiaBootstrap: { windowId: "main", profileId: "default", capabilities: [] },
  setTimeout, clearTimeout, addEventListener() {}, console,
  chrome: { send(name, [requestId, operation, payload]) {
    assert.equal(name, "ardiaRequest");
    assert.equal(operation, "engine.call");
    calls.push({ name: payload.name, profile: payload.profile, args: payload.args === null ? null : JSON.parse(payload.args) });
    const reply = replies.get(payload.name) ?? null;
    queueMicrotask(() => {
      if (reply && reply.fail) context.__ardiaReply(requestId, false, reply.fail);
      else context.__ardiaReply(requestId, true, JSON.stringify(reply?.value ?? null));
    });
  } },
};
context.window = context;
context.top = context;
runInNewContext(bootstrap, context);
globalThis.__siteControlsHost = context.__ardiaHost;

const sites = await import("../../browser/src/platform/siteSettings.ts");
const blocker = await import("../../browser/src/platform/contentBlocker.ts");
const core = await import("../../browser/src/platform/profiles.ts");

const last = () => calls.at(-1);

test("site permission calls reach the native sites domain with the profile and exact arguments", async () => {
  replies.set("sites.settings", { value: { camera: { value: "allow", isDefault: false } } });
  assert.deepEqual(await sites.getSiteSettings("default", "https://a.test"), { camera: { value: "allow", isDefault: false } });
  assert.deepEqual(last(), { name: "sites.settings", profile: "default", args: { origin: "https://a.test", engine: "chromium" } });
  assert.equal(await sites.setSiteSetting("default", "https://a.test", "camera", "block"), null);
  assert.deepEqual(last(), { name: "sites.setSetting", profile: "default", args: { origin: "https://a.test", type: "camera", value: "block", engine: "chromium" } });
  replies.set("sites.origins", { value: ["https://a.test"] });
  assert.deepEqual(await sites.getSiteSettingsOrigins(""), ["https://a.test"]);
  assert.deepEqual(last(), { name: "sites.origins", profile: "default", args: {} });
  await sites.resetSiteSettings("default", "https://a.test");
  assert.deepEqual(last(), { name: "sites.reset", profile: "default", args: { origin: "https://a.test" } });
  replies.set("sites.clearData", { value: { cookies: 3, storage: true } });
  assert.deepEqual(await sites.clearSiteData("default", "https://a.test"), { cookies: 3, storage: true });
  assert.deepEqual(last(), { name: "sites.clearData", profile: "default", args: { origin: "https://a.test", engine: "chromium" } });
});

test("clearing browsing data sends the chosen types and time range, and resolves only after the engine does", async () => {
  await core.clearBrowsingData("default", ["cache", "siteData"], 1761500000000);
  assert.deepEqual(last(), { name: "profiles.clearBrowsingData", profile: "default", args: { types: ["cache", "siteData"], since: 1761500000000 } });
  await core.clearBrowsingData("default", ["history", "siteData", "cache", "downloads"]);
  assert.deepEqual(last().args, { types: ["history", "siteData", "cache", "downloads"], since: null });
  replies.set("profiles.clearBrowsingData", { fail: { code: "ERR_CLEAR_INCOMPLETE", message: "Some browsing data could not be cleared" } });
  await assert.rejects(core.clearBrowsingData("default", ["cache"]), (error) => error.code === "ERR_CLEAR_INCOMPLETE");
  replies.set("profiles.clearBrowsingData", { fail: { code: "ERR_PROFILE_PRIVATE", message: "Private sessions keep no site settings or browsing data" } });
  await assert.rejects(core.clearBrowsingData("incognito:w1@default", ["cache"]), (error) => error.code === "ERR_PROFILE_PRIVATE");
  assert.equal(last().profile, "incognito:w1@default");
  replies.delete("profiles.clearBrowsingData");
});

test("content blocker calls use the app-level contentBlocker domain and surface explicit unavailability", async () => {
  const state = { enabled: true, version: "1.75.0", lists: [], allowedHosts: [], stats: { ready: true, enabled: true, parseMs: 0, lookups: 0, averageLookupMicros: 0, maxLookupMicros: 0 } };
  replies.set("contentBlocker.state", { value: state });
  assert.deepEqual(await blocker.getContentBlocker(), state);
  assert.deepEqual(last(), { name: "contentBlocker.state", profile: "default", args: {} });
  await blocker.setContentBlockerEnabled(false);
  assert.deepEqual(last(), { name: "contentBlocker.setEnabled", profile: "default", args: { enabled: false } });
  await blocker.setFilterListEnabled("easylist", true);
  assert.deepEqual(last(), { name: "contentBlocker.setListEnabled", profile: "default", args: { id: "easylist", enabled: true } });
  replies.set("contentBlocker.isAllowed", { value: true });
  assert.equal(await blocker.isContentBlockerAllowed("news.example.com"), true);
  assert.deepEqual(last(), { name: "contentBlocker.isAllowed", profile: "default", args: { host: "news.example.com" } });
  await blocker.setContentBlockerAllowed("example.com", true);
  assert.deepEqual(last(), { name: "contentBlocker.setAllowed", profile: "default", args: { host: "example.com", allowed: true } });
  replies.set("contentBlocker.setEnabled", { fail: { code: "ERR_CONTENT_BLOCKER_UNAVAILABLE", message: "the content blocker is not installed" } });
  await assert.rejects(blocker.setContentBlockerEnabled(true), (error) => error.name === "ArdiaError" && error.code === "ERR_CONTENT_BLOCKER_UNAVAILABLE");
});

test("contentBlocker.changed events from the host reach shared listeners and stop after removal", async () => {
  const seen = [];
  const subscription = blocker.onContentBlockerChange((stats) => seen.push(stats));
  context.__ardiaEvent("ArdiaContentBlocker", "contentBlocker", { name: "contentBlocker.changed", data: { ready: true, enabled: false } });
  context.__ardiaEvent("ArdiaContentBlocker", "contentBlocker", { name: "contentBlocker.other", data: { ready: false } });
  context.__ardiaEvent("ArdiaDownloads", "downloads", { name: "contentBlocker.changed", data: { ready: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [{ ready: true, enabled: false }]);
  subscription.remove();
  context.__ardiaEvent("ArdiaContentBlocker", "contentBlocker", { name: "contentBlocker.changed", data: { ready: true } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.length, 1);
});
