import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";
import { linuxCapabilities, unavailablePanes, unavailableSettingIds } from "./hostCapabilities.ts";
import { CAST_UNAVAILABLE_TITLE, linuxMediaCall } from "./hostCast.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { useToasts } from "../../browser/src/state/app/toasts.ts";

function fakeHost(capabilities = []) {
  const invoked = [];
  return {
    invoked,
    host: {
      bootstrap: { windowId: "w1", profileId: "default", capabilities },
      invoke: async (method, args) => { invoked.push(method); throw new Error(`Unknown host method ${method}`); },
      call: async () => "{}",
      onEvent: () => () => {},
    },
  };
}

test("absent default-browser, login and scrollbar backends answer truthfully without reaching the host", async () => {
  const { host, invoked } = fakeHost();
  const system = (method) => resolveHostModule(host, "ArdiaSystem", method);
  await assert.rejects(system("isDefaultBrowser")(), { code: "ERR_UNAVAILABLE" });
  await assert.rejects(system("setAsDefaultBrowser")(), { code: "ERR_UNAVAILABLE" });
  assert.equal(await system("launchAtLoginStatus")(), "notFound");
  await assert.rejects(system("setLaunchAtLogin")(true), { code: "ERR_UNAVAILABLE" });
  assert.equal(await system("setThinScrollBars")(true), undefined);
  assert.deepEqual(invoked, []);
});

test("a host that advertises a system backend is called through instead of being masked", async () => {
  const { host, invoked } = fakeHost(["ArdiaSystem.isDefaultBrowser", "ArdiaSystem.setAsDefaultBrowser", "ArdiaSystem.setThinScrollBars"]);
  await assert.rejects(resolveHostModule(host, "ArdiaSystem", "isDefaultBrowser")(), /Unknown host method/);
  await assert.rejects(resolveHostModule(host, "ArdiaSystem", "setThinScrollBars")(true), /Unknown host method/);
  assert.deepEqual(invoked, ["ArdiaSystem.isDefaultBrowser", "ArdiaSystem.setThinScrollBars"]);
});

test("Linux capabilities come from the host contract, and WebKit is never offered", () => {
  assert.deepEqual(linuxCapabilities(fakeHost().host), {
    defaultBrowser: false, launchAtLogin: false, thinScrollBars: false, webkit: false, cliControl: false, externalLinks: false, performanceRecording: false, taskManager: false, videoUpscaling: false,
  });
  const full = linuxCapabilities(fakeHost(["ArdiaSystem.isDefaultBrowser", "ArdiaSystem.setAsDefaultBrowser", "ArdiaSystem.launchAtLoginStatus", "ArdiaSystem.setLaunchAtLogin", "ArdiaSystem.setThinScrollBars", "engine.beginTracing", "engine.endTracing", "engine.isTracing", "engine.openTaskManager", "ArdiaApp.openExternalURL"]).host);
  assert.deepEqual(full, { defaultBrowser: true, launchAtLogin: true, thinScrollBars: true, webkit: false, cliControl: false, externalLinks: true, performanceRecording: true, taskManager: true, videoUpscaling: false });
  assert.equal(linuxCapabilities(undefined).taskManager, false);
});

test("unavailable choices map to exact settings ids and the Engines pane", () => {
  const ids = ["general.defaultBrowser", "general.openAtLogin", "general.warnBeforeQuitting", "appearance.pageScrollBars", "engines.defaultEngine", "engines.protectedVideo", "search.otherEngines", "advanced.cliControl", "advanced.cliInstall", "advanced.showFullUrl", "tabs.videoUpscaling", "tabs.autoPictureInPicture"];
  const none = linuxCapabilities(fakeHost().host);
  assert.deepEqual([...unavailableSettingIds(none, ids)].sort(), ["advanced.cliControl", "advanced.cliInstall", "appearance.pageScrollBars", "engines.defaultEngine", "engines.protectedVideo", "general.defaultBrowser", "general.openAtLogin", "tabs.videoUpscaling"]);
  assert.deepEqual([...unavailablePanes(none)], ["engines"]);
  assert.deepEqual([...unavailableSettingIds({ ...none, defaultBrowser: true, launchAtLogin: true, thinScrollBars: true, cliControl: true, videoUpscaling: true }, ids)].sort(), ["engines.defaultEngine", "engines.protectedVideo"]);
});

test("onboarding music and external links answer locally when the host has no backend for them", async () => {
  const { host, invoked } = fakeHost();
  const app = (method) => resolveHostModule(host, "ArdiaApp", method);
  assert.equal(await app("playIntroMusic")({}, false), undefined);
  assert.equal(await app("setIntroMusicMuted")(true), undefined);
  assert.equal(await app("stopIntroMusic")(0.6), undefined);
  assert.equal(await app("openExternalURL")("mailto:someone@example.com"), false);
  assert.deepEqual(invoked, []);
  const advertised = fakeHost(["ArdiaApp.openExternalURL"]);
  await assert.rejects(resolveHostModule(advertised.host, "ArdiaApp", "openExternalURL")("mailto:x"), /Unknown host method/);
  assert.deepEqual(advertised.invoked, ["ArdiaApp.openExternalURL"]);
});

const nativeSource = (path) => readFileSync(new URL(`../../../engine/ardiacore-linux/src/ardia/linux/${path}`, import.meta.url), "utf8");
const listedRoutes = (path, list, route = /"([^"]+)"/g) => {
  const source = nativeSource(path);
  const start = source.indexOf(`${list}[]`);
  return [...source.slice(start, source.indexOf(";", start)).matchAll(route)].map((match) => match[1]);
};

test("the native bootstrap advertises every route list, and every shared performance engine call is advertised or gated", () => {
  const host = nativeSource("ac_linux_host.cc");
  const bootstrap = host.slice(host.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), host.indexOf("void ShellHostView::LayoutOverlay()"));
  for (const list of ["linux_contract::kRoutes", "kLinuxZoomDomainRoutes", "kLinuxMemorySaverRoutes"]) assert.ok(bootstrap.includes(`: ardiacore::${list})`), list);
  const advertised = new Set([
    ...listedRoutes("ac_linux_contract.h", "kRoutes", /\{"([^"]+)",/g),
    ...listedRoutes("ac_linux_history_zoom.h", "kLinuxZoomDomainRoutes"),
    ...listedRoutes("ac_linux_memory_saver.h", "kLinuxMemorySaverRoutes"),
    ...[...host.matchAll(/capabilities\.Append\("(engine\.\w+)"\)/g)].map((match) => match[1]),
  ]);
  assert.equal(linuxCapabilities(fakeHost([...advertised]).host).taskManager, true);
  const used = [...readFileSync(new URL("../../browser/src/platform/performance.ts", import.meta.url), "utf8").matchAll(/^export const \w+ = [^\n]*?\b(?:call|on)\("(engine\.\w+)"/gm)].map((match) => match[1]);
  for (const call of ["engine.memorySaver", "engine.validateKeepActiveSite", "engine.tasks"]) assert.ok(used.includes(call), call);
  const gated = { "engine.beginTracing": "performanceRecording", "engine.endTracing": "performanceRecording", "engine.isTracing": "performanceRecording" };
  const none = linuxCapabilities(fakeHost().host);
  for (const call of used) {
    if (advertised.has(call)) continue;
    assert.ok(gated[call], `${call} is neither advertised by the Linux host nor gated`);
    assert.equal(none[gated[call]], false);
  }
});

test("Memory Saver settings and kept-active site checks reach the host as engine calls for the window's profile", async () => {
  const calls = [];
  const replies = { "engine.memorySaver": { state: "off", aggressiveness: "maximum", active: false, sites: ["youtube.com"], invalid: [] }, "engine.validateKeepActiveSite": { valid: true } };
  const host = {
    bootstrap: { windowId: "w1", profileId: "work", capabilities: ["engine.memorySaver", "engine.validateKeepActiveSite"] },
    invoke: async (method) => { throw new Error(`Unknown host method ${method}`); },
    call: async (name, profile, args) => { calls.push([name, profile, JSON.parse(args)]); return JSON.stringify(replies[name]); },
    onEvent: () => () => {},
  };
  const engineCall = resolveHostModule(host, "ArdiaEngine", "call");
  const request = { state: "off", aggressiveness: "maximum", sites: ["youtube.com"] };
  assert.deepEqual(JSON.parse(await engineCall("memorySaver", "", JSON.stringify(request))), replies["engine.memorySaver"]);
  assert.deepEqual(JSON.parse(await engineCall("validateKeepActiveSite", "", JSON.stringify({ site: "youtube.com" }))), { valid: true });
  assert.deepEqual(calls, [["engine.memorySaver", "work", request], ["engine.validateKeepActiveSite", "work", { site: "youtube.com" }]]);
});

test("accepting a site's notification prompt on Linux settles quietly when the desktop has no notification permission to ask", async () => {
  const { shellNativeModules } = await import("../../browser/src/test-native/index.ts");
  const { ensureNotificationPermission } = await import("./notificationPermission.ts");
  const app = shellNativeModules.ArdiaApp;
  const original = app.notificationPermission;
  const unhandled = [];
  const record = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  app.notificationPermission = () => Promise.reject(Object.assign(new Error("Desktop notifications is unavailable on Linux"), { code: "ERR_UNAVAILABLE" }));
  try {
    assert.equal(await ensureNotificationPermission("main"), false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    app.notificationPermission = original;
    process.off("unhandledRejection", record);
  }
});

test("casting answers with an explicit unavailable state instead of a silent rejection", async () => {
  useBrowser.getState().hydrate({});
  const windowId = useBrowser.getState().createWindow({ url: "https://cast.ardia.test/" });
  const tabId = useBrowser.getState().windows[windowId].tabIds[0];
  useToasts.setState({ toasts: {} });
  assert.equal(await linuxMediaCall("showCastDialog", JSON.stringify({ tabId })), "false");
  assert.equal(useToasts.getState().toasts[windowId]?.title, CAST_UNAVAILABLE_TITLE);
  assert.equal(await linuxMediaCall("watchCastRoutes", JSON.stringify({ profile: "" })), "null");
  for (const verb of ["startCasting", "stopCasting", "closeCastDialog", "terminateCastRoute", "changeCaptureSource", "stopCapture"]) {
    await assert.rejects(linuxMediaCall(verb, "{}"), (error) => error.code === "ERR_UNAVAILABLE", verb);
  }
});

test("the media domain keeps reaching the host for everything but casting", async () => {
  const calls = [];
  const host = { bootstrap: { capabilities: [], nativeModules: {} }, call: async (name) => { calls.push(name); return "null"; }, invoke: async () => null, onEvent: () => {} };
  const call = resolveHostModule(host, "ArdiaMedia", "call");
  assert.equal(await call("selectDevice", "", JSON.stringify({ id: 1, index: 0 })), "null");
  assert.equal(await call("showCastDialog", "", JSON.stringify({ tabId: "missing" })), "false");
  assert.deepEqual(calls, ["media.selectDevice"]);
});
