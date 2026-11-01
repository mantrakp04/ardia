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
globalThis.__promptsHost.onEvent((module, event, payload) => events.emit(module, event, payload));
export function requireNativeModule(name) {
  return new Proxy({}, { get(_target, key) {
    if (key === "addListener") return (event, listener) => events.add(name, event, listener);
    return resolveHostModule(globalThis.__promptsHost, name, key);
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
  __ardiaBootstrap: { windowId: "main", profileId: "default", capabilities: ["permissions.externalAppAllowances"] },
  setTimeout, clearTimeout, addEventListener() {}, console,
  chrome: { send(name, [requestId, operation, payload]) {
    assert.equal(name, "ardiaRequest");
    assert.equal(operation, "engine.call");
    calls.push({ name: payload.name, profile: payload.profile, args: payload.args === null ? null : JSON.parse(payload.args) });
    const reply = replies.get(payload.name) ?? null;
    queueMicrotask(() => context.__ardiaReply(requestId, true, JSON.stringify(reply ?? null)));
  } },
};
context.window = context;
context.top = context;
runInNewContext(bootstrap, context);
globalThis.__promptsHost = context.__ardiaHost;

const permissions = await import("../../browser/src/state/site/permissions.ts");
const prompts = await import("../../browser/src/state/site/prompts.ts");
const sites = await import("../../browser/src/platform/siteSettings.ts");
const { pageOf, patchPage } = await import("../../browser/src/state/tabs/pageState.ts");

const emit = (name, data) => context.__ardiaEvent("ArdiaPermissions", "permissions", { name, data });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

permissions.startPermissionPrompts();

test("a native permission request shows on its tab and Allow resolves it with remember", async () => {
  calls.length = 0;
  emit("permissions.requested", { id: "p1", tabId: "tab-a", origin: "https://cam.test/", permissions: ["camera", "microphone"] });
  assert.equal(pageOf("tab-a").permission?.id, "p1");
  emit("permissions.requested", { id: "p2", tabId: "tab-a", origin: "https://cam.test/", permissions: ["location"] });
  assert.equal(pageOf("tab-a").permission?.id, "p1");
  permissions.answerPermission("tab-a", "p1", "accept");
  await settle();
  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [["permissions.resolve", { id: "p1", result: "accept", remember: true }]]);
  assert.equal(pageOf("tab-a").permission?.id, "p2");
  permissions.answerPermission("tab-a", "p2", "deny");
  await settle();
  assert.deepEqual(calls.at(-1).args, { id: "p2", result: "deny", remember: true });
  assert.equal(pageOf("tab-a").permission, null);
});

test("a prompt Chromium withdraws leaves its tab, and leaving the page dismisses what is left", async () => {
  calls.length = 0;
  emit("permissions.requested", { id: "p3", tabId: "tab-b", origin: "https://geo.test/", permissions: ["location"] });
  emit("permissions.requested", { id: "p4", tabId: "tab-b", origin: "https://geo.test/", permissions: ["notifications"] });
  emit("permissions.dismissed", { id: "p3" });
  assert.equal(pageOf("tab-b").permission?.id, "p4");
  permissions.dismissPermissions("tab-b");
  await settle();
  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [["permissions.resolve", { id: "p4", result: "dismiss", remember: false }]]);
  assert.equal(pageOf("tab-b").permission, null);
});

test("a request delivered again after a remount is shown once", async () => {
  calls.length = 0;
  const request = { id: "p6", tabId: "tab-e", origin: "https://cam.test/", permissions: ["camera"] };
  emit("permissions.requested", request);
  emit("permissions.requested", { id: "p7", tabId: "tab-e", origin: "https://cam.test/", permissions: ["location"] });
  emit("permissions.requested", request);
  emit("permissions.requested", { id: "p7", tabId: "tab-e", origin: "https://cam.test/", permissions: ["location"] });
  permissions.answerPermission("tab-e", "p6", "deny");
  assert.equal(pageOf("tab-e").permission?.id, "p7");
  permissions.answerPermission("tab-e", "p7", "deny");
  assert.equal(pageOf("tab-e").permission, null);
  await settle();
  assert.deepEqual(calls.map(({ args }) => args.id), ["p6", "p7"]);
});

test("a request for a tab this window does not show is ignored", () => {
  emit("permissions.requested", { id: "p5", tabId: null, origin: "https://x.test/", permissions: ["camera"] });
  assert.equal(pageOf("tab-c").permission, null);
});

test("the external app answer goes to the engine with its id, and only once", async () => {
  calls.length = 0;
  const request = { id: "x1", url: "ardiatest://hello", scheme: "ardiatest", origin: "https://app.test", app: "Test", appPath: null, icon: null, title: "Open “Test”?", message: "https://app.test wants to open this application.", remember: "Always allow" };
  patchPage("tab-d", { externalApp: request });
  prompts.answerExternalApp("tab-d", true, true);
  prompts.answerExternalApp("tab-d", true, true);
  await settle();
  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [["permissions.resolveExternalApp", { id: "x1", open: true, remember: true }]]);
  assert.equal(pageOf("tab-d").externalApp, null);
});

test("remembered external apps are read and removed through the engine routes", async () => {
  calls.length = 0;
  replies.set("permissions.externalAppAllowances", [{ origin: "https://app.test", scheme: "ardiatest", app: "Test", icon: null }]);
  assert.deepEqual(await sites.getExternalAppAllowances("default"), [{ origin: "https://app.test", scheme: "ardiatest", app: "Test", icon: null }]);
  await sites.removeExternalAppAllowance("default", "https://app.test", "ardiatest");
  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [
    ["permissions.externalAppAllowances", {}],
    ["permissions.removeExternalAppAllowance", { origin: "https://app.test", scheme: "ardiatest" }],
  ]);
});
