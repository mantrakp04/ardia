import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const now = Date.now();
const previousStart = now - 3 * 60 * 60_000;
Object.assign(stub.appInfo, { appVersion: "0.3.1", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false, processStart: now - 2000, bootTime: now - 60_000 });
const previousContext = {
  at: previousStart + 90 * 60_000,
  session_start: previousStart,
  tabs: 2464,
  windows: 2,
  profiles: 1,
  footprint_mb: 1762,
  app_memory_mb: 9800,
  free_disk_gb: 3.4,
  memory_pressure: "critical",
  page_processes_gone: 1,
};
stub.docs.set(
  "telemetry.json",
  JSON.stringify({ version: 1, sharing: true, installId: "install", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: "0.3.0", sessionOpen: true, lastLaunchAt: previousStart, context: previousContext }),
);
globalThis.fetch = async () => ({ status: 503 });

const client = await import("./client.ts");
const { reportNativeCrashes } = await import("./errors.ts");
const diagnostics = await import("./diagnostics.ts");
const presses = await import("./tabPresses.ts");
after(() => client.setSharing(false, "settings"));

const events = (name) => JSON.parse(stub.docs.get("telemetry-queue.json") ?? "{}").events?.filter((e) => e.event === name) ?? [];
const session = client.startClient();

test("an unclean launch hands back the last context the crashed session saved", () => {
  assert.equal(session.previous, "unclean");
  assert.equal(session.updatedFrom, "0.3.0");
  assert.deepEqual(session.context, previousContext);
  const props = diagnostics.contextProperties(session.context, "prev_", now);
  assert.equal(props.prev_tabs, 2464);
  assert.equal(props.prev_memory_pressure, "critical");
  assert.equal(props.prev_session_min, 90);
  assert.equal(props.prev_age_min, 90);
});

test("a crash of the previous version arrives on the next one, tagged with the version that crashed and its context", async () => {
  stub.diagnostics.crashReports = [
    {
      time: previousStart + 100 * 60_000,
      process: "browser",
      appVersion: "0.3.0",
      build: "104",
      exceptionType: "EXC_BREAKPOINT",
      signal: "SIGTRAP",
      terminationNamespace: "SIGNAL",
      uptimeSeconds: 6000,
      vmWritableMB: 12000,
      frames: [{ image: "Chromium Framework", offset: 0x10 }],
    },
    {
      time: previousStart + 101 * 60_000,
      process: "renderer",
      engineVersion: "156.0.8078.79",
      exceptionType: "EXC_BAD_ACCESS",
      signal: "SIGSEGV",
      uptimeSeconds: 40,
      frames: [{ image: "Chromium Framework", offset: 0x20 }],
    },
  ];
  await reportNativeCrashes([session.context]);
  const [browser, renderer] = events("$exception").slice(-2).map((e) => e.properties);
  assert.equal(browser.source, "native_crash");
  assert.equal(browser.crash_process, "browser");
  assert.equal(browser.crashed_version, "0.3.0");
  assert.equal(browser.crashed_build, "104");
  assert.equal(browser.$app_version, "0.3.1");
  assert.equal(browser.crash_termination, "SIGNAL");
  assert.equal(browser.crash_uptime_s, 6000);
  assert.equal(browser.crash_vm_writable_mb, 12000);
  assert.equal(browser.ctx_tabs, 2464);
  assert.equal(browser.ctx_free_disk_gb, 3.4);
  assert.equal(browser.ctx_age_min, 10);
  assert.equal(renderer.source, "helper_crash");
  assert.equal(renderer.crash_process, "renderer");
  assert.equal(renderer.crashed_version, null);
  assert.equal(renderer.crashed_engine_version, "156.0.8078.79");
  assert.equal(renderer.$exception_list[0].mechanism.type, "helper_crash");
  assert.equal(client.crashCursor(), previousStart + 101 * 60_000);
});

test("a crash gets the latest context sampled at or before it in its own session, else none", async () => {
  const start = stub.appInfo.processStart;
  const sample = (at) => ({ ...previousContext, at, session_start: start, tabs: at - start });
  stub.diagnostics.crashReports = [
    { time: start + 1000, fileTime: start + 1900, process: "renderer", frames: [] },
    { time: start + 1200, fileTime: start + 1950, process: "renderer", frames: [] },
  ];
  await reportNativeCrashes([session.context, sample(start + 500), sample(start + 1100)]);
  const [first, second] = events("$exception").slice(-2).map((e) => e.properties);
  assert.equal(first.ctx_tabs, 500);
  assert.equal(second.ctx_tabs, 1100);
  assert.equal(client.crashCursor(), start + 1950);
  stub.diagnostics.crashReports = [{ time: start + 2500, fileTime: start + 2600, process: "renderer", frames: [] }];
  await reportNativeCrashes([session.context, sample(start + 3000)]);
  const late = events("$exception").at(-1).properties;
  assert.equal("ctx_tabs" in late, false, "a sample taken after the crash, or one from an older session, is not its context");
});

test("a crash from before the saved context's session gets no context", async () => {
  stub.diagnostics.crashReports = [{ time: previousStart - 1000 + 200 * 60_000, process: "gpu", frames: [] }];
  await reportNativeCrashes([{ ...previousContext, session_start: previousStart + 300 * 60_000 }]);
  const props = events("$exception").at(-1).properties;
  assert.equal(props.crash_process, "gpu");
  assert.equal("ctx_tabs" in props, false);
});

test("hardware comes as chip, GPU, memory, displays and hardware decode flags, no model or serial", async () => {
  stub.diagnostics.hardware = { chip: "Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz", gpu: "AMD Radeon Pro 5500M", memoryGB: 32, displays: 2, maxScale: 2, hardwareDecode: { av1: false, vp9: false, hevc: true, h264: true } };
  assert.deepEqual(await diagnostics.hardwareProperties(), {
    chip: "Intel Core i9-9980HK CPU",
    gpu: "AMD Radeon Pro 5500M",
    memory_gb: 32,
    displays: 2,
    max_scale: 2,
    hw_decode_av1: false,
    hw_decode_vp9: false,
    hw_decode_hevc: true,
    hw_decode_h264: true,
  });
});

test("a recorded context is saved for the next launch and holds only counts and sizes", async () => {
  const context = await diagnostics.recordContext();
  assert.deepEqual(Object.keys(context).sort(), ["app_memory_mb", "at", "footprint_mb", "free_disk_gb", "memory_pressure", "page_processes_gone", "profiles", "session_start", "tabs", "webui_page", "windows"]);
  assert.equal(context.webui_page, null);
  assert.equal(context.footprint_mb, 500);
  assert.equal(JSON.parse(stub.docs.get("telemetry.json")).context.footprint_mb, 500);
});

test("the built-in page is the host and first path segment of an ardia:// or chrome:// URL, and null for any web URL", () => {
  const page = diagnostics.webuiPage;
  assert.equal(page("chrome://settings/cookies"), "settings/cookies");
  assert.equal(page("ardia://settings/cookies"), "settings/cookies");
  assert.equal(page("CHROME://Settings/Cookies/detail?site=https%3A%2F%2Fprivate.example#top"), "settings/cookies");
  assert.equal(page("chrome://settings/?search=private"), "settings");
  assert.equal(page("ardia://history"), "history");
  assert.equal(page("ardia://newtab/"), "newtab");
  assert.equal(page("chrome://net-internals#dns"), "net-internals");
  assert.equal(page("chrome://settings/some-text-that-is-longer-than-a-page-name-could-be"), "settings");
  for (const url of ["https://example.com/settings/cookies", "http://localhost:3000/chrome://settings", "https://chrome/settings", "view-source:chrome://settings/cookies", "about:blank", "file:///Users/me/ardia://history", "chrome://user@private.example/x", "chrome://my.private.example/x", "chrome://", "", null, undefined]) {
    assert.equal(page(url), null, String(url));
  }
});

test("the context sample records the built-in page the active tab is on, and a navigation to or from one samples at once", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  const S = () => useBrowser.getState();
  S().hydrate({});
  const w = S().createWindow({ url: "https://private.example/inbox?token=secret" });
  const tab = S().windows[w].tabIds[0];
  assert.equal((await diagnostics.recordContext()).webui_page, null);

  const sampled = () => diagnostics.contextSamples().length;
  const waitForSample = async (from) => {
    for (let i = 0; i < 200 && sampled() === from; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    return diagnostics.contextSamples().at(-1);
  };
  diagnostics.startContextSamples();
  try {
    let from = sampled();
    S().updateTab(tab, { url: "https://private.example/other", title: "Other" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sampled(), from, "a web page change takes no extra sample");

    S().updateTab(tab, { url: "chrome://settings/cookies" });
    const settings = await waitForSample(from);
    assert.equal(settings.webui_page, "settings/cookies");
    assert.equal(settings.session_start, stub.appInfo.processStart);
    assert.equal(JSON.parse(stub.docs.get("telemetry.json")).context.webui_page, "settings/cookies");

    const after = Math.max(settings.at, client.crashCursor()) + 1000;
    stub.diagnostics.crashReports = [{ time: after, fileTime: after + 500, process: "browser", frames: [{ image: "Chromium Framework", offset: 0x30 }] }];
    await reportNativeCrashes([settings]);
    const crash = events("$exception").at(-1).properties;
    assert.equal(crash.crash_process, "browser");
    assert.equal(crash.ctx_webui_page, "settings/cookies");

    from = sampled();
    S().updateTab(tab, { url: "https://private.example/" });
    const away = await waitForSample(from);
    assert.equal(away.webui_page, null, "leaving the page is sampled too, so a later crash isn't blamed on it");
  } finally {
    diagnostics.stopContextSamples();
  }
});

test("the built-in page comes from the focused window's tab, a Little Ardia window included", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  const S = () => useBrowser.getState();
  S().hydrate({});
  S().createWindow({ url: "chrome://history" });
  const small = S().createWindow({ kind: "small", url: "https://private.example/" });
  S().setFocusedWindow(small);
  assert.equal((await diagnostics.recordContext()).webui_page, null);
});

test("a burst of built-in page samples keeps the samples from before it, so a crash read an hour later still finds its context", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  useBrowser.getState().hydrate({});
  useBrowser.getState().createWindow({ url: "chrome://settings/cookies" });
  const beforeBurst = await diagnostics.recordContext();
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (let i = 0; i < 30; i++) await diagnostics.recordContext();
  const found = diagnostics.contextAt(diagnostics.contextSamples(), beforeBurst.at, [beforeBurst.session_start]);
  assert.equal(found?.at, beforeBurst.at);
  assert.equal(found?.webui_page, "settings/cookies");
});

test("two samples recorded in the same millisecond: the later one is the context", () => {
  const first = { at: 1000, session_start: 500, webui_page: null };
  const later = { at: 1000, session_start: 500, webui_page: "settings/cookies" };
  assert.equal(diagnostics.contextAt([first, later], 1000, [500])?.webui_page, "settings/cookies");
});

test("a page process that goes away sends its reason, exit code, visibility and counts, capped per session", async () => {
  diagnostics.trackPageProcessGone({ reason: "oom", code: 9 }, true, { translate: "translating", translate_stage: "model", translating_tabs: 2, translated_tabs: 1 });
  diagnostics.trackPageProcessGone({ reason: "https://private.example", code: 1.5 }, false);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await client.saveQueueNow();
  const [oom, odd] = events("page_process_gone").map((e) => e.properties);
  assert.equal(oom.reason, "oom");
  assert.equal(oom.exit_code, 9);
  assert.equal(oom.visible, true);
  assert.equal(oom.gone_this_session, 1);
  assert.equal(oom.translate, "translating");
  assert.equal(oom.translate_stage, "model");
  assert.equal(oom.translating_tabs, 2);
  assert.equal(oom.translated_tabs, 1);
  assert.equal(odd.translate, undefined);
  assert.equal(odd.reason, "unknown");
  assert.equal(odd.exit_code, null);
  for (let i = 0; i < 40; i++) diagnostics.trackPageProcessGone({ reason: "crashed", code: 11 }, false);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await client.saveQueueNow();
  assert.equal(events("page_process_gone").length, 30);
});

test("a lost-hover episode sends only its enums, flags and duration, capped per session", async () => {
  const episode = { reason: "halfActive", halfActive: true, appActive: false, runningActive: true, frontmost: true, menuActive: true, trigger: "click", keyWindow: "blockerPage", mainWindow: "none", preventKey: true, canKey: false, windowMain: true, overPage: true, cover: "none", coverClear: false, healed: true, healWorked: true, endedBy: "heal", seconds: 3.4, episode: 1 };
  diagnostics.trackHoverLost(episode);
  diagnostics.trackHoverLost({ ...episode, reason: "https://private.example", keyWindow: "Title of a page", endedBy: 7, healWorked: null, seconds: -5, trigger: "drag" });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await client.saveQueueNow();
  const [healed, odd] = events("page_hover_lost").map((e) => e.properties);
  assert.equal(healed.reason, "halfActive");
  assert.equal(healed.half_active, true);
  assert.equal(healed.app_active, false);
  assert.equal(healed.running_active, true);
  assert.equal(healed.frontmost, true);
  assert.equal(healed.menu_active, true);
  assert.equal(healed.trigger, "click");
  assert.equal(healed.key_window, "blockerPage");
  assert.equal(healed.main_window, "none");
  assert.equal(healed.prevent_key, true);
  assert.equal(healed.can_key, false);
  assert.equal(healed.window_main, true);
  assert.equal(healed.healed, true);
  assert.equal(healed.heal_worked, true);
  assert.equal(healed.ended_by, "heal");
  assert.equal(healed.lost_seconds, 3);
  assert.equal(odd.reason, "unknown");
  assert.equal(odd.key_window, "unknown");
  assert.equal(odd.ended_by, "unknown");
  assert.equal(odd.heal_worked, null);
  assert.equal(odd.lost_seconds, 0);
  assert.equal(odd.trigger, "move");
  for (let i = 0; i < 30; i++) diagnostics.trackHoverLost(episode);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await client.saveQueueNow();
  assert.equal(events("page_hover_lost").length, 20);
});

test("tab presses count clicks, drags turned into clicks, drags and presses that got no answer", async () => {
  presses.notePressStarted(true);
  presses.notePressEnded("click", "t1");
  presses.notePagePress("t1");
  presses.notePressStarted(true);
  presses.notePressEnded("dragClick", "t2");
  presses.notePressStarted(true);
  presses.notePressEnded("drag");
  presses.notePressStarted();
  presses.notePressStarted();
  presses.notePressEnded("click", "t3");
  presses.notePagePress("t4");
  stub.pressesWithoutRelease.count = 2;
  stub.pressRepeated.earlier = { landedOn: "RCTView<Surface", ms: 600 };
  await presses.noteRowPress(true);
  stub.pressRepeated.earlier = { landedOn: "RCTView<Surface", ms: 20 };
  await presses.noteRowPress(true);
  stub.pressRepeated.earlier = null;
  presses.emitTabPresses();
  await client.saveQueueNow();
  const props = events("tab_presses").at(-1).properties;
  assert.deepEqual([props.repeat_presses, props.repeat_on_new_tab, props.repeat_gap_ms_p50, props.repeat_landed_on], [1, 1, 600, "RCTView<Surface"]);
  assert.equal(props.lost_releases, 2);
  assert.equal(props.presses, 5);
  assert.equal(props.clicks, 2);
  assert.equal(props.drag_clicks, 1);
  assert.equal(props.drags, 1);
  assert.equal(props.unanswered, 1);
  assert.equal(props.down_switches, 3);
  assert.equal(props.held_n, 2);
  assert.ok(props.held_ms_p50 >= 0 && props.held_ms_p50 < 1000);
  assert.equal(props.page_click_n, 1);
  assert.ok(props.page_click_ms_p50 >= 0 && props.page_click_ms_p50 < 1000);
  presses.emitTabPresses();
  await client.saveQueueNow();
  assert.equal(events("tab_presses").length, 1);
  stub.pressesWithoutRelease.count = 3;
  presses.emitTabPresses();
  await client.saveQueueNow();
  assert.equal(events("tab_presses").length, 2);
  assert.deepEqual([events("tab_presses").at(-1).properties.lost_releases, events("tab_presses").at(-1).properties.presses], [1, 0]);
});

test("turning sharing off forgets pending presses and samples, so they never go out under the next install id", async () => {
  await diagnostics.recordContext();
  assert.ok(diagnostics.contextSamples().length > 0);
  presses.notePressStarted();
  presses.notePressEnded("click", "t9");
  presses.notePressStarted();
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  assert.equal(diagnostics.contextSamples().length, 0);
  presses.notePagePress("t9");
  presses.notePressEnded("click", "t9");
  presses.emitTabPresses();
  await client.saveQueueNow();
  assert.equal(events("tab_presses").length, 0);
  assert.deepEqual(presses.devTabPresses(), { presses: 0, down_switches: 0, clicks: 0, drag_clicks: 0, drags: 0, unanswered: 0, pending: false, toPageClick: 0, held: 0 });
});

test("with sharing off no context is saved, and tab presses stay in the local copy, never queued", async () => {
  client.setSharing(false, "settings");
  assert.equal(await diagnostics.recordContext(), null);
  assert.equal(JSON.parse(stub.docs.get("telemetry.json")).context, null);
  presses.notePressStarted();
  presses.notePressEnded("click", "t1");
  presses.emitTabPresses();
  const { flushLocal } = await import("./localStore.ts");
  flushLocal();
  const local = stub.telemetryLocal.records().filter((r) => r.event === "tab_presses");
  assert.equal(local.at(-1).sent, false);
  assert.equal(local.at(-1).distinct_id, null);
  assert.equal(client.devState().queued.events, 0);
});
