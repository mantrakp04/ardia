import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";
import { linuxCapabilities, unavailablePanes, unavailableSettingIds } from "./hostCapabilities.ts";

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
const contractRoutes = () => {
  const source = nativeSource("ac_linux_contract.h");
  const table = source.slice(source.indexOf("kRoutes[] = {"), source.indexOf("};", source.indexOf("kRoutes[] = {")));
  return [...table.matchAll(/\{"([^"]+)",/g)].map((match) => match[1]);
};

test("the native bootstrap advertises every contract route, so engine capabilities can turn on", () => {
  const host = nativeSource("ac_linux_host.cc");
  const bootstrap = host.slice(host.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), host.indexOf("void ShellHostView::LayoutOverlay()"));
  assert.match(bootstrap, /for \(const auto& route : ardiacore::linux_contract::kRoutes\)\s*capabilities\.Append\(route\.name\);/);
  const routes = contractRoutes();
  assert.ok(routes.includes("engine.openTaskManager"));
  const advertised = linuxCapabilities(fakeHost(routes).host);
  assert.equal(advertised.taskManager, true);
  assert.equal(advertised.performanceRecording, ["engine.beginTracing", "engine.endTracing", "engine.isTracing"].every((name) => routes.includes(name)));
});

test("the native bootstrap advertises the intercepted site zoom routes from the same list the dispatcher uses", () => {
  const host = nativeSource("ac_linux_host.cc");
  const bootstrap = host.slice(host.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), host.indexOf("void ShellHostView::LayoutOverlay()"));
  assert.match(bootstrap, /for \(const char\* route : ardiacore::kLinuxZoomDomainRoutes\)\s*capabilities\.Append\(route\);/);
  assert.match(host, /if \(ardiacore::IsLinuxZoomDomainRoute\(name\)\) \{/);
  const zoom = nativeSource("ac_linux_history_zoom.h");
  const routes = [...zoom.slice(zoom.indexOf("kLinuxZoomDomainRoutes[]"), zoom.indexOf("};", zoom.indexOf("kLinuxZoomDomainRoutes[]"))).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(routes, ["sites.zoomLevels", "sites.setZoom"]);
  for (const route of routes) assert.ok(!contractRoutes().includes(route));
});

const listedRoutes = (path, list) => {
  const source = nativeSource(path);
  const start = source.indexOf(`${list}[]`);
  return [...source.slice(start, source.indexOf(";", start)).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};

test("the native bootstrap advertises the Memory Saver routes from the list the dispatcher intercepts", () => {
  const host = nativeSource("ac_linux_host.cc");
  const bootstrap = host.slice(host.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), host.indexOf("void ShellHostView::LayoutOverlay()"));
  assert.match(bootstrap, /for \(const char\* route : ardiacore::kLinuxMemorySaverRoutes\)\s*capabilities\.Append\(route\);/);
  assert.match(host, /if \(ardiacore::IsLinuxMemorySaverRoute\(name\)\) \{/);
  assert.match(host, /if \(ardiacore::IsLinuxMemorySaverRoute\(reply->name\)\) \{/);
  const routes = listedRoutes("ac_linux_memory_saver.h", "kLinuxMemorySaverRoutes");
  assert.deepEqual(routes, ["engine.memorySaver", "engine.validateKeepActiveSite"]);
  for (const route of routes) assert.ok(!contractRoutes().includes(route));
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

test("every engine call behind the shared performance module is advertised by the Linux host or gated by a Linux capability", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const used = [...read("../../browser/src/platform/performance.ts").matchAll(/^export const \w+ = [^\n]*?\b(?:call|on)\("(engine\.\w+)"/gm)].map((match) => match[1]);
  for (const call of ["engine.memorySaver", "engine.validateKeepActiveSite", "engine.batterySaver", "engine.trimMemory", "engine.tasks", "engine.systemState"]) assert.ok(used.includes(call), call);
  const host = nativeSource("ac_linux_host.cc");
  const advertised = new Set([
    ...contractRoutes(),
    ...listedRoutes("ac_linux_history_zoom.h", "kLinuxZoomDomainRoutes"),
    ...listedRoutes("ac_linux_memory_saver.h", "kLinuxMemorySaverRoutes"),
    ...[...host.matchAll(/capabilities\.Append\("(engine\.\w+)"\)/g)].map((match) => match[1]),
  ]);
  const gated = { "engine.beginTracing": "performanceRecording", "engine.endTracing": "performanceRecording", "engine.isTracing": "performanceRecording" };
  const none = linuxCapabilities(fakeHost().host);
  for (const call of used) {
    if (advertised.has(call)) continue;
    assert.ok(gated[call], `${call} is neither advertised by the Linux host nor gated`);
    assert.equal(none[gated[call]], false);
  }
});

test("Task Manager and tracing follow the advertised contract rather than the mere presence of a host", () => {
  assert.equal(linuxCapabilities(fakeHost().host).taskManager, false);
  assert.equal(linuxCapabilities(fakeHost(["engine.openTaskManager"]).host).taskManager, true);
  assert.equal(linuxCapabilities(fakeHost(["engine.beginTracing", "engine.endTracing", "engine.isTracing"]).host).performanceRecording, true);
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
  assert.match(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8"), /here\("\.\.\/browser\/src\/state\/site\/webNotifications\.ts"\)\}\\0\$\{here\("\.\.\/browser\/src\/state\/site\/permissions\.ts"\)\}`, here\("\.\/src\/notificationPermission\.ts"\)/);
});
