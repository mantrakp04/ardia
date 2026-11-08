import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { engineProfile, windowTitle } = await import("../browser/model.ts");
const { createWindowSync } = await import("./windowSync.ts");

const S = () => useBrowser.getState();
const PROFILES = { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } };
const reset = () => S().hydrate({ profiles: PROFILES, profileOrder: ["default"], windows: {}, tabs: {} });

function fakePort(nativeIds = []) {
  const calls = [];
  let listener = () => {};
  const port = {
    open: (id, options, lightsCenter) => calls.push(["open", id, options, lightsCenter]),
    close: (id) => calls.push(["close", id]),
    setTitle: (id, title) => calls.push(["setTitle", id, title]),
    setTitleOverride: (id, title) => calls.push(["setTitleOverride", id, title]),
    windowIds: async () => nativeIds,
    restoreFullScreen: (ids, focus) => calls.push(["restoreFullScreen", ids, focus]),
    onEvent: (l) => void (listener = l),
    releaseProfile: (profile) => calls.push(["releaseProfile", profile]),
  };
  return { port, calls, emit: (e) => listener(e), of: (kind) => calls.filter((c) => c[0] === kind) };
}

function start(native, quitting = { on: false }) {
  const sync = createWindowSync({
    port: native.port,
    getState: S,
    isQuitting: () => quitting.on,
    lightsCenter: (s, id) => (s.windows[id]?.kind === "small" ? [1, 1] : [2, 2]),
    isUtilityWindow: (id) => id === "settings",
  });
  sync.listen();
  return sync;
}

test("launch: every window opens once with its lights center, the focused one first, none animated", () => {
  reset();
  const a = S().createWindow();
  const b = S().createWindow();
  const native = fakePort();
  const sync = start(native);
  sync.sync(S());
  const opens = native.of("open");
  assert.deepEqual(opens.map((c) => c[1]), [b, a]);
  assert.equal(opens[0][2].focus, true);
  assert.equal(opens[1][2].behind, b);
  assert.ok(opens.every((c) => !c[2].animated && c[3][0] === 2));
  assert.equal(opens[0][2].title, windowTitle(S(), b));
  sync.sync(S(), S());
  assert.equal(native.of("open").length, 2);
});

test("after launch: a new window opens animated, a closed one closes and its private profile is released", () => {
  reset();
  S().createWindow();
  const native = fakePort();
  const sync = start(native);
  sync.sync(S());
  let prev = S();
  const priv = S().createWindow({ kind: "private" });
  sync.sync(S(), prev);
  const opened = native.of("open").at(-1);
  assert.equal(opened[1], priv);
  assert.equal(opened[2].animated, true);
  assert.equal(opened[2].incognito, true);
  const profile = engineProfile(S(), S().windows[priv].profileId);
  prev = S();
  S().closeWindow(priv);
  sync.sync(S(), prev);
  assert.deepEqual(native.of("close"), [["close", priv]]);
  assert.deepEqual(native.of("releaseProfile"), [["releaseProfile", profile]]);
});

test("a window native closed leaves the store without a second close, unless the app is quitting", () => {
  reset();
  const a = S().createWindow();
  const b = S().createWindow();
  const quitting = { on: false };
  const native = fakePort();
  const sync = start(native, quitting);
  sync.sync(S());
  quitting.on = true;
  native.emit({ type: "close", id: a });
  native.emit({ type: "fullScreen", id: b, on: true });
  assert.ok(S().windows[a]);
  assert.ok(!S().windows[b].fullScreen);
  quitting.on = false;
  const prev = S();
  native.emit({ type: "close", id: a });
  assert.equal(S().windows[a], undefined);
  sync.sync(S(), prev);
  assert.deepEqual(native.of("close"), []);
});

test("titles: only a changed title is sent", () => {
  reset();
  const a = S().createWindow();
  const native = fakePort();
  const sync = start(native);
  sync.sync(S());
  let prev = S();
  S().setWindowFrame(a, [0, 0, 800, 600]);
  sync.sync(S(), prev);
  assert.deepEqual(native.of("setTitle"), []);
  prev = S();
  S().newTab(a);
  sync.sync(S(), prev);
  assert.deepEqual(native.of("setTitle"), [["setTitle", a, windowTitle(S(), a)]]);
});

const loaded = (url) => ({ kind: "loaded", nav: { url, seq: 1 } });

test("title override: a chromium page owns its window title, any other active tab names it", () => {
  reset();
  const w = S().createWindow();
  const native = fakePort();
  const sync = start(native);
  sync.sync(S());
  const overrides = () => native.of("setTitleOverride").map((c) => c.slice(1));
  assert.deepEqual(overrides(), [[w, "New Tab"]]);

  let prev = S();
  const page = S().newTab(w, { url: "https://a.example/" });
  S().updateTab(page, { title: "Alpha", page: loaded("https://a.example/") });
  sync.sync(S(), prev);
  assert.deepEqual(overrides().at(-1), [w, null]);

  prev = S();
  const webkit = S().newTab(w, { url: "https://b.example/" });
  S().updateTab(webkit, { title: "Beta", engine: "webkit", page: loaded("https://b.example/") });
  sync.sync(S(), prev);
  assert.deepEqual(overrides().at(-1), [w, "Beta"]);

  prev = S();
  S().updateTab(webkit, { title: "Beta 2" });
  sync.sync(S(), prev);
  assert.deepEqual(overrides().at(-1), [w, "Beta 2"]);

  const count = overrides().length;
  prev = S();
  S().setWindowFrame(w, [0, 0, 800, 600]);
  sync.sync(S(), prev);
  assert.equal(overrides().length, count);

  prev = S();
  S().activate(page);
  sync.sync(S(), prev);
  assert.deepEqual(overrides().at(-1), [w, null]);

  prev = S();
  S().newTab(w);
  sync.sync(S(), prev);
  assert.deepEqual(overrides().at(-1), [w, "New Tab"]);
});

test("startup sweep: closes native windows the store doesn't have, keeps utility windows, titles the rest", async () => {
  reset();
  const a = S().createWindow();
  const native = fakePort(["orphan", "settings", a]);
  const sync = start(native);
  sync.sync(S());
  await sync.sweep();
  assert.deepEqual(native.of("close"), [["close", "orphan"]]);
  assert.deepEqual(native.of("setTitle"), [["setTitle", a, windowTitle(S(), a)]]);
  assert.deepEqual(native.of("setTitleOverride").at(-1), ["setTitleOverride", a, "New Tab"]);
  assert.deepEqual(native.of("setTitleOverride").map((c) => c[1]), [a, a]);
});

test("a window the user closed is forgotten: the same id opening again gets its title and override sent again", () => {
  reset();
  const a = S().createWindow();
  const native = fakePort();
  const sync = start(native);
  sync.sync(S());
  const before = S();
  assert.deepEqual(native.of("setTitleOverride"), [["setTitleOverride", a, "New Tab"]]);
  native.emit({ type: "close", id: a });
  const after = S();
  assert.equal(after.windows[a], undefined);
  sync.sync(after, before);
  useBrowser.setState(before, true);
  sync.sync(before, after);
  assert.equal(native.of("open").filter((c) => c[1] === a).length, 2);
  assert.deepEqual(native.of("setTitleOverride"), [["setTitleOverride", a, "New Tab"], ["setTitleOverride", a, "New Tab"]]);
});

test("full screen comes back oldest first", () => {
  reset();
  const a = S().createWindow();
  const b = S().createWindow();
  const native = fakePort();
  const sync = start(native);
  const s = S();
  sync.restoreFullScreen({ ...s, windows: { ...s.windows, [a]: { ...s.windows[a], fullScreen: 2 }, [b]: { ...s.windows[b], fullScreen: 1 } } });
  assert.deepEqual(native.of("restoreFullScreen"), [["restoreFullScreen", [b, a], (s.ui.focusOrder[0] ?? null)]]);
});
