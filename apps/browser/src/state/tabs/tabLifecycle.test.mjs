import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.__DEV__ = false;

const performance = import.meta.resolve("../../platform/performance.ts");
const profiles = import.meta.resolve("../../platform/profiles.ts");
globalThis.engineCalls = [];
const stubs = {
  "../../platform/performance": `export * from ${JSON.stringify(performance)};
    export const onSystemState = () => ({ remove() {} });
    export const systemState = async () => null;
    export const setBatterySaver = async (mode) => (globalThis.engineCalls.push(["batterySaver", mode]), { state: 0, active: false });
    export const setMemorySaver = async (request) => (globalThis.engineCalls.push(["memorySaver", request]), { ...request, active: request.state === "on", invalid: [] });`,
  "../../platform/profiles": `export * from ${JSON.stringify(profiles)};
    export const releaseProfile = async () => {};`,
  "../app/toasts": "export const showToast = () => {};",
  "../settings/settingsWindows": "export const openSettings = () => {};",
  "../pages/urls": "export const isInternalTab = (t) => !/^https?:/.test(t.url ?? '');",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!/\/state\/tabs\/(?:tabLifecycle|memorySaver|shownTabs|recentTabWarmup)\.ts$/.test(context.parentURL ?? "") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../browser/store.ts");
const lifecycle = await import("./tabLifecycle.ts");
const { keepActiveSiteOf, memorySaverRequest } = await import("./memorySaver.ts");
const { reloadRecentTabs } = await import("./recentTabWarmup.ts");
const { loadSession: loadSavedSession } = await import("../session/persist.ts");
const { docs: savedDocs } = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const memorySaverCalls = () => globalThis.engineCalls.filter(([name]) => name === "memorySaver").map(([, request]) => request);

test("the app's Memory Saver settings reach the engine at launch and on every change", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  S().hydrate({ settings: { memorySaver: false, memorySaverMode: "maximum", keepActiveSites: ["music.youtube.com"] } });
  globalThis.engineCalls.length = 0;
  lifecycle.startTabLifecycle();
  assert.deepEqual(memorySaverCalls(), [{ state: "off", aggressiveness: "maximum", sites: ["music.youtube.com"] }]);
  S().updateSettings({ memorySaver: true });
  S().updateSettings({ memorySaverMode: "moderate" });
  S().updateSettings({ keepActiveSites: ["music.youtube.com", "figma.com"] });
  S().updateSettings({ showFullUrl: !S().settings.showFullUrl });
  assert.deepEqual(memorySaverCalls().slice(1), [
    { state: "on", aggressiveness: "maximum", sites: ["music.youtube.com"] },
    { state: "on", aggressiveness: "moderate", sites: ["music.youtube.com"] },
    { state: "on", aggressiveness: "moderate", sites: ["music.youtube.com", "figma.com"] },
  ]);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(globalThis.engineCalls.filter(([name]) => name === "batterySaver").map(([, mode]) => mode), ["off"], "Battery Saver is always Chrome's: on or off, never left to Chrome's default");
});

test("a saved Memory Saver mode or site list the engine wouldn't take falls back instead of reaching it", () => {
  assert.deepEqual(memorySaverRequest({ memorySaver: true, memorySaverMode: "turbo", keepActiveSites: ["a.com", 3] }), { state: "on", aggressiveness: "balanced", sites: ["a.com"] });
  assert.deepEqual(memorySaverRequest({ memorySaver: undefined, memorySaverMode: undefined, keepActiveSites: undefined }), { state: "on", aggressiveness: "balanced", sites: [] });
});

test("a kept-active site lowercases only its scheme and host, since Chrome matches the path and query as typed", () => {
  assert.equal(keepActiveSiteOf("  HTTPS://Example.COM/Editor?Doc=AbC "), "https://example.com/Editor?Doc=AbC");
  assert.equal(keepActiveSiteOf("Docs.Google.com/Document/D/XyZ"), "docs.google.com/Document/D/XyZ");
  assert.equal(keepActiveSiteOf("[*.]YouTube.com"), "[*.]youtube.com");
  assert.equal(keepActiveSiteOf("https://Figma.com/"), "https://figma.com", "a bare trailing slash goes, as before");
  assert.equal(keepActiveSiteOf("music.youtube.com"), "music.youtube.com");
});

test("a synced list saved with lowercased entries reaches the engine unchanged", () => {
  assert.deepEqual(memorySaverRequest({ memorySaver: true, memorySaverMode: "balanced", keepActiveSites: ["https://example.com/editor"] }).sites, ["https://example.com/editor"]);
});

test("a tab Chrome discarded shows as sleeping until it's ready again or gone", () => {
  S().hydrate({});
  lifecycle.noteDiscarded("t1");
  lifecycle.noteDiscarded("t2");
  assert.deepEqual(lifecycle.useLifecycle.getState().discarded, { t1: true, t2: true });
  lifecycle.noteReady("t1");
  lifecycle.noteGone("t2");
  assert.deepEqual(lifecycle.useLifecycle.getState().discarded, {});
});

test("a pinned tab Memory Saver's timer put to sleep is counted; a tab put to sleep by hand, under memory pressure or unpinned is not", async () => {
  const { takeTabSleepCounts } = await import("../telemetry/tabSleepCounts.ts");
  const takePinnedTabsSleptByMemorySaver = () => takeTabSleepCounts().pinned_tabs_slept_by_memory_saver;
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const tile = S().newTab(w, { url: "https://tile.com/", background: true });
  const row = S().newTab(w, { url: "https://row.com/", background: true });
  const plain = S().newTab(w, { url: "https://plain.com/", background: true });
  S().updateTab(tile, { pin: { as: "tile" } });
  S().updateTab(row, { pin: { as: "row" } });
  takePinnedTabsSleptByMemorySaver();
  lifecycle.noteDiscarded(tile, "proactive");
  lifecycle.noteDiscarded(row, "proactive");
  lifecycle.noteDiscarded(plain, "proactive");
  assert.equal(takePinnedTabsSleptByMemorySaver(), 2);
  assert.equal(lifecycle.useLifecycle.getState().discarded[tile], true);
  lifecycle.noteDiscarded(tile, "external");
  lifecycle.noteDiscarded(tile, "urgent");
  lifecycle.noteDiscarded(tile, null);
  lifecycle.noteDiscarded(tile);
  assert.equal(takePinnedTabsSleptByMemorySaver(), 0);
  for (const id of [tile, row, plain]) lifecycle.noteGone(id);
});

test("Battery Saver turns on at 20% battery or lower, in Low Power Mode, or whenever unplugged when asked to", () => {
  const sys = (onBattery, batteryLevel, lowPowerMode = false) => ({ onBattery, batteryLevel, lowPowerMode, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 });
  const wanted = (when, state) => lifecycle.batterySaverWanted(when, state).on;
  assert.equal(wanted("lowBattery", sys(true, 0.8)), false, "on battery with charge left");
  assert.equal(wanted("lowBattery", sys(true, 0.2)), true);
  assert.equal(wanted("lowBattery", sys(true, 0.204)), true, "shows as 20%");
  assert.equal(wanted("lowBattery", sys(true, 0.21)), false);
  assert.equal(wanted("lowBattery", sys(false, 0.1)), false, "plugged in");
  assert.equal(wanted("lowBattery", sys(false, 0.9, true)), true, "Low Power Mode");
  assert.equal(wanted("lowBattery", sys(true, null)), false, "no battery level");
  assert.equal(wanted("unplugged", sys(true, 0.9)), true);
  assert.equal(wanted("unplugged", sys(false, 0.9)), false);
  assert.equal(wanted("never", sys(true, 0.05, true)), false);
  assert.equal(wanted("lowBattery", null), false);
});

test("Battery Saver turned on by low battery stays on through 20%/21% readings until the Mac is plugged in", () => {
  const sys = (onBattery, batteryLevel) => ({ onBattery, batteryLevel, lowPowerMode: false, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 });
  let held = false;
  const step = (when, state) => {
    const next = lifecycle.batterySaverWanted(when, state, held);
    held = next.lowBatteryHeld;
    return next.on;
  };
  assert.deepEqual([0.21, 0.2, 0.21, 0.2, 0.21, 0.5].map((level) => step("lowBattery", sys(true, level))), [false, true, true, true, true, true]);
  assert.equal(step("lowBattery", sys(false, 0.21)), false, "plugged in");
  assert.equal(step("lowBattery", sys(true, 0.21)), false, "unplugged again above 20%");
  assert.equal(step("lowBattery", sys(true, 0.2)), true);
  assert.equal(step("never", sys(true, 0.2)), false);
  assert.equal(step("lowBattery", sys(true, 0.21)), false, "a changed setting starts over");
});

test("Battery Saver's old switch: a choice and any off are kept, the old default moves to When battery is low", () => {
  const hydrated = (settings) => {
    savedDocs.set("session.json", JSON.stringify({ version: 7, profiles: S().profiles, profileOrder: S().profileOrder, settings, windows: [], windowOrder: [], tabs: [], groups: [], splits: [] }));
    S().hydrate(loadSavedSession());
    return { ...S().settings, chosen: S().settingsMeta.chosen };
  };
  const untouched = hydrated({ batterySaver: true, showFullUrl: true, chosen: ["showFullUrl"], inferred: [] });
  assert.equal(untouched.batterySaverWhen, "lowBattery");
  assert.equal("batterySaver" in untouched, false);
  assert.deepEqual(untouched.chosen, ["showFullUrl"]);
  const off = hydrated({ batterySaver: false, chosen: ["batterySaver"], inferred: [] });
  assert.equal(off.batterySaverWhen, "never");
  assert.deepEqual(off.chosen, ["batterySaverWhen"]);
  assert.equal(hydrated({ batterySaver: true, chosen: ["batterySaver"], inferred: [] }).batterySaverWhen, "unplugged");
  assert.equal(hydrated({ batterySaver: false, chosen: ["batterySaver"], inferred: ["batterySaver"] }).batterySaverWhen, "never", "off was never the default, so it was chosen");
  assert.equal(hydrated({ batterySaver: false }).batterySaverWhen, "never", "legacy save turned off");
  assert.equal(hydrated({ batterySaver: true, chosen: ["batterySaver"], inferred: ["batterySaver"] }).batterySaverWhen, "lowBattery", "on, saved before choices were tracked");
  assert.equal(hydrated({ batterySaver: true }).batterySaverWhen, "lowBattery", "legacy save left on");
  assert.equal(hydrated({ batterySaverWhen: "never", chosen: ["batterySaverWhen"] }).batterySaverWhen, "never");
});

test("a recent pin queued for warming at launch stays closed when the user closes it before its turn", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const pin = S().newTab(w, { url: "https://p.com", background: true, pinned: true });
  const warm = S().newTab(w, { url: "https://q.com", background: true, pinned: true });
  const cold = (id) => ({ ...S().tabs[id], page: { kind: "idle" }, lastActiveAt: Date.now() });
  useBrowser.setState({ tabs: { ...S().tabs, [pin]: cold(pin), [warm]: cold(warm) } });
  const sys = { physicalMemory: 32 * 2 ** 30, onBattery: false, lowPowerMode: false, memoryPressure: "normal" };

  const queued = reloadRecentTabs(sys);
  assert.ok(queued.includes(pin) && queued.includes(warm));
  S().activate(pin);
  S().closeTab(pin);
  assert.equal(S().tabs[pin].page.kind, "asleep");
  t.mock.timers.tick(2000 * queued.length);

  assert.equal(S().tabs[pin].page.kind, "asleep", "the closed pin stays closed");
  assert.equal(S().tabs[pin].page.nav, undefined);
  assert.ok(S().tabs[warm].page.nav, "a pin left alone still warms up");
  assert.notEqual(S().tabs[warm].page.kind, "asleep");
});

test("past the mode's cap, the least recently seen hidden tabs go to sleep; a shown, playing, kept or just-hidden tab stays loaded", async () => {
  const { tabsOverCap, isKeptSite, noteLeftShown } = await import("./loadedTabCap.ts");
  S().hydrate({});
  const w = S().createWindow({ url: "https://active.com/" });
  const ids = Array.from({ length: 14 }, (_, i) => S().newTab(w, { url: `https://site${i}.com/`, background: true }));
  const now = Date.now() + 10 * 60_000;
  ids.forEach((id, i) => S().updateTab(id, { lastActiveAt: now - (i + 2) * 60_000 }));
  const active = Object.keys(S().tabs).find((id) => !ids.includes(id));
  const loaded = [active, ...ids];
  const over = (seen = new Map()) => tabsOverCap(S(), loaded, seen, now);
  const oldestFirst = (list) => [...list].reverse();
  assert.deepEqual(over(), oldestFirst(ids.slice(9)), "Balanced keeps 10 loaded tabs: the shown one and the 9 most recently seen hidden ones");
  S().updateSettings({ memorySaverMode: "maximum" });
  assert.deepEqual(over(), oldestFirst(ids.slice(4)));
  S().updateSettings({ memorySaverMode: "balanced" });
  assert.deepEqual(over(new Map([[ids[13], now - 1000]])), oldestFirst(ids.slice(8, 13)), "a tab hidden less than a minute ago counts as just seen");
  S().updateLive(ids[12], { playingAudio: true });
  S().updateSettings({ keepActiveSites: ["[*.]site11.com"] });
  assert.deepEqual(over(), [ids[13], ids[10], ids[9], ids[8], ids[7]], "a protected tab doesn't count as slept: the next oldest hidden tabs go instead");
  assert.deepEqual(tabsOverCap(S(), loaded, new Map(), now, new Set([ids[13]])), [ids[10], ids[9], ids[8], ids[7], ids[6]], "a tab its page kept awake is skipped for the next one");
  S().updateSettings({ memorySaver: false });
  assert.deepEqual(over(), [], "Memory Saver off keeps every tab loaded");
  S().updateSettings({ memorySaver: true });
  assert.deepEqual(tabsOverCap(S(), loaded.slice(0, 10), new Map(), now), [], "at or under the cap nothing sleeps");
  const seen = new Map();
  const before = S();
  S().activate(ids[13]);
  const shownAt = S();
  S().activate(active);
  noteLeftShown(seen, shownAt, before, now - 59_000);
  noteLeftShown(seen, S(), shownAt, now - 1000);
  assert.equal(seen.get(ids[13]), now - 1000, "a tab counts as seen until it leaves the shown set, not since the last sweep");
  assert.equal(isKeptSite("https://docs.google.com/document/d/1", ["docs.google.com/document"]), true);
  assert.equal(isKeptSite("https://docs.google.com/spreadsheets", ["docs.google.com/document"]), false);
  assert.equal(isKeptSite("https://www.youtube.com/watch", ["[*.]youtube.com"]), true);
  assert.equal(isKeptSite("https://sub.example.com:8443/app", ["[*.]example.com"]), true, "a port doesn't hide the host from a wildcard rule");
  assert.equal(isKeptSite("https://youtube.com.evil.net/", ["youtube.com"]), false);
  assert.equal(isKeptSite("https://Example.com/Editor?Doc=AbC", ["example.com/Editor?Doc=AbC"]), true);
  assert.equal(isKeptSite("https://example.com/editor?doc=abc", ["example.com/Editor?Doc=AbC"]), false, "a path keeps its case, as Chrome matches it");
});

const browserBinary = () => {
  const home = process.env.HOME ?? "";
  const cache = [`${home}/.cache/ms-playwright`, `${home}/Library/Caches/ms-playwright`].filter((dir) => existsSync(dir));
  const fromCache = cache.flatMap((dir) => readdirSync(dir).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).map((d) => join(dir, d)));
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...fromCache.flatMap((dir) => [
      join(dir, "chrome-headless-shell-linux64/chrome-headless-shell"),
      join(dir, "chrome-linux/chrome"),
      join(dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    ]),
  ];
  return candidates.find((path) => path && existsSync(path));
};

test("the page check keeps edited fields, touched editors and playing media, inside shadow roots too, and lets untouched pages sleep", { skip: !browserBinary() && "no Chrome to run pages in" }, async () => {
  const { PAGE_IS_BUSY } = await import("./loadedTabCap.ts");
  const probe = PAGE_IS_BUSY.replace(/post\("result", ([\s\S]*)\);\s*\}\)\(\)$/, "return $1;\n})()");
  const profile = mkdtempSync(join(tmpdir(), "page-check-"));
  const chrome = spawn(browserBinary(), ["--headless", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = "";
      chrome.stderr.on("data", (chunk) => {
        text += chunk;
        const found = /DevTools listening on (ws:\S+)/.exec(text);
        if (found) resolve(found[1]);
      });
      chrome.on("exit", () => reject(new Error(text)));
    });
    const port = new URL(endpoint).port;
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    let next = 0;
    const waiting = new Map();
    socket.addEventListener("message", (e) => {
      const message = JSON.parse(e.data);
      waiting.get(message.id)?.(message);
    });
    const call = (method, params) => new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    await call("Page.enable", {});
    const busy = async (html, setup = "", gesture = false) => {
      const loaded = new Promise((resolve) => socket.addEventListener("message", function onLoad(e) {
        if (JSON.parse(e.data).method === "Page.loadEventFired") socket.removeEventListener("message", onLoad), resolve();
      }));
      await call("Page.navigate", { url: `data:text/html,${encodeURIComponent(html)}` });
      await loaded;
      if (setup || gesture) await call("Runtime.evaluate", { expression: setup || "0", userGesture: gesture, awaitPromise: true });
      return JSON.parse((await call("Runtime.evaluate", { expression: probe, returnByValue: true })).result.result.value);
    };
    const selects = "<select id=a><option>x<option>y</select><select id=b><option>x<option selected>y</select><select id=c><option selected>p<option selected>q</select><select id=d><option disabled>pick<option>e<option>g</select><select></select><select size=3><option>a</select><select multiple><option>a<option selected>b</select><input id=t value=hi>";
    const shadow = (inner) => `<x-box></x-box><script>document.querySelector("x-box").attachShadow({ mode: "open" }).innerHTML = ${JSON.stringify(inner)}</script>`;
    assert.equal(await busy(selects), false, "untouched fields");
    for (const edit of ["a.selectedIndex = 1", "b.selectedIndex = 0", "c.selectedIndex = 0", "d.selectedIndex = 2", "t.value = 'edited'"])
      assert.equal(await busy(selects, `const [a, b, c, d, t] = ["a", "b", "c", "d", "t"].map((id) => document.getElementById(id)); ${edit}`), true, edit);
    assert.equal(await busy(shadow("<textarea></textarea>")), false, "an untouched field in a shadow root");
    assert.equal(await busy(shadow("<textarea></textarea>"), "document.querySelector('x-box').shadowRoot.querySelector('textarea').value = 'draft'"), true, "an edited field in a shadow root");
    assert.equal(await busy(shadow("<div contenteditable>hi</div>"), "", true), true, "a touched editor in a shadow root");
    assert.equal(await busy("<iframe srcdoc='<textarea></textarea>'></iframe>"), false, "an untouched page with an iframe");
    assert.equal(await busy("<iframe srcdoc='<textarea></textarea>'></iframe>", "", true), true, "a touched page with an iframe");
    assert.equal(await busy("<div contenteditable>hi</div>", "", true), true, "a touched editor");
    assert.equal(await busy("<p>text</p>", "", true), false, "a touched page with nothing to lose");
    socket.close();
  } finally {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
  }
});
