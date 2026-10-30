import assert from "node:assert/strict";
import test from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { engineProfile } from "../../browser/src/state/browser/model.ts";
import { initialHostSession, snapshotHostSession, startHostPersistence } from "./hostSession.ts";
import { createHostWindowOpener, dropRefusedWindow, pendingOpenings, privateWindowSeed, windowOpened, withPrivateWindow } from "./hostWindowProfiles.ts";

const S = () => useBrowser.getState();
const tick = () => new Promise(setImmediate);
const quiet = (run) => async (...args) => {
  const error = console.error;
  console.error = () => {};
  try { return await run(...args); } finally { console.error = error; }
};

function regularSession() {
  const initial = initialHostSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null);
  S().hydrate(initial);
  const work = S().createProfile({ name: "Work" });
  const shared = S().createProfile({ name: "Side", shareWith: "default" });
  S().setFocusedWindow("main");
  return { work, shared };
}

function fakeHost({ reject, pending = false, bootstrap = { windowId: "main", profileId: "default", startup: false } } = {}) {
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    bootstrap,
    invoke(method, args) {
      calls.push([method, structuredClone(args)]);
      if (method === "ArdiaShell.openWindow" && reject) return Promise.reject(Object.assign(new Error(reject), { code: "ERR_PROFILE_UNAVAILABLE" }));
      return Promise.resolve(method === "ArdiaShell.openWindow" && pending ? { pending: true } : null);
    },
    call: async () => "null",
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    native: (event) => { for (const listener of [...listeners]) listener("ArdiaShell", "onWindowEvent", event); },
  };
}

test("a window whose native creation fails is closed in shell state so no phantom window remains", quiet(async () => {
  const { work } = regularSession();
  const id = S().createWindow({ profileId: work, background: true });
  const host = fakeHost({ reject: "Chrome could not open this profile" });
  const events = [];
  const open = createHostWindowOpener(host, () => S(), (event) => events.push(event));
  await open(id, { profile: engineProfile(S(), S().windows[id].profileId) });
  assert.deepEqual(host.calls, [["ArdiaShell.openWindow", { args: [id, { profile: work }] }]]);
  assert.deepEqual(events, [{ type: "close", id }]);

  const opened = fakeHost();
  const none = [];
  await createHostWindowOpener(opened, () => S(), (event) => none.push(event))(id, { profile: work });
  assert.deepEqual(none, [], "a created window is left alone");

  const gone = [];
  await createHostWindowOpener(fakeHost({ reject: "no" }), () => S(), (event) => gone.push(event))("w-missing", { profile: "" });
  assert.deepEqual(gone, [], "nothing to reconcile for a window the shell no longer has");
}));

test("private windows open with their own seed and never fall back to a regular window", quiet(async () => {
  const { work } = regularSession();
  S().setFocusedWindow("main");
  const id = S().createWindow({ kind: "private", profileId: work, url: "https://private.test/" });
  const w = S().windows[id];
  assert.equal(engineProfile(S(), w.profileId), `incognito:${id}@${work}`);
  const host = fakeHost();
  await createHostWindowOpener(host, () => S(), () => {})(id, { incognito: true, profile: engineProfile(S(), w.profileId) });
  const [, { args: [sentId, options] }] = host.calls[0];
  assert.equal(sentId, id);
  assert.equal(options.privateWindow.window.id, id);
  assert.equal(options.privateWindow.window.kind, "private");
  assert.deepEqual(Object.keys(options.privateWindow.tabs), w.tabIds);
  assert.equal(Object.values(options.privateWindow.tabs)[0].url, "https://private.test/");
  assert.equal(options.privateWindow.window.chromeWindow, undefined);

  const events = [];
  const noSeed = fakeHost();
  await createHostWindowOpener(noSeed, () => ({ windows: { [id]: { ...w, kind: "main" } }, tabs: S().tabs }), (event) => events.push(event))(id, { incognito: true, profile: engineProfile(S(), w.profileId) });
  assert.deepEqual(noSeed.calls, [], "no regular-window state is sent as a private window");
  assert.deepEqual(events, [{ type: "close", id }]);

  assert.equal(privateWindowSeed(S(), "main"), undefined);
}));

test("a private window renderer starts from its seed, and a missing seed fails instead of opening a regular window", () => {
  const { work } = regularSession();
  const saved = snapshotHostSession(S());
  const id = S().createWindow({ kind: "private", profileId: work, url: "https://private.test/" });
  const seed = privateWindowSeed(S(), id);
  const pageProfile = engineProfile(S(), S().windows[id].profileId);
  const bootstrap = { windowId: id, profileId: "default", startup: false, pageProfile, privateWindow: seed };
  const session = initialHostSession({ bootstrap }, saved);
  assert.equal(session.windows[id].kind, "private");
  assert.equal(session.windows[id].profileId, S().windows[id].profileId);
  assert.equal(session.focusedWindowId, id);
  assert.deepEqual(session.windows[id].tabIds, seed.window.tabIds);
  assert.equal(session.windows.main.kind, "main", "public windows stay as they were");
  assert.ok(!Object.values(session.windows).some((x) => x.id !== id && x.kind === "private"));

  assert.throws(() => initialHostSession({ bootstrap: { ...bootstrap, privateWindow: undefined } }, saved), /private window state/);
  assert.throws(() => initialHostSession({ bootstrap: { ...bootstrap, pageProfile: `incognito:${id}@` } }, saved), /private window state/);
  const foreign = { ...seed, tabs: { ...seed.tabs, intruder: { ...Object.values(seed.tabs)[0], id: "intruder", profileId: work } } };
  const filtered = withPrivateWindow({ bootstrap: { ...bootstrap, privateWindow: foreign } }, saved);
  assert.equal(filtered.tabs.intruder, undefined, "only the private window's own tabs are adopted");
  assert.equal(withPrivateWindow({ bootstrap: { windowId: "main", profileId: "default", pageProfile: "" } }, saved), undefined);
});

test("private windows, their tabs and their closed entries never reach session persistence", async () => {
  const { work } = regularSession();
  const id = S().createWindow({ kind: "private", profileId: work, url: "https://private.test/" });
  const seed = privateWindowSeed(S(), id);
  const saved = snapshotHostSession(S());
  const bootstrap = { windowId: id, profileId: "default", startup: false, pageProfile: engineProfile(S(), S().windows[id].profileId), privateWindow: seed };
  S().hydrate(initialHostSession({ bootstrap }, saved));
  const privateTab = S().windows[id].tabIds[0];
  S().closeTabs([privateTab]);
  S().createWindow({ kind: "private", profileId: "default", url: "https://second-private.test/" });
  const writes = [];
  const host = {
    bootstrap,
    invoke: async (method, pair) => { writes.push([method, structuredClone(pair)]); return pair.session; },
    onEvent: () => () => {},
  };
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const persistence = startHostPersistence(host, useBrowser, saved);
  try {
    S().updateSettings({ sidebarWidth: 301 });
    await persistence.flush();
    await tick();
  } finally {
    persistence();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
  assert.ok(writes.length > 0);
  for (const [method, { session }] of writes) {
    assert.equal(method, "session.write");
    const json = JSON.stringify(session);
    assert.ok(!json.includes("incognito:"), "no private profile identity is written");
    assert.ok(!json.includes("private.test"), "no private page is written");
    assert.ok(!Object.values(session.windows).some((w) => w.incognito || w.kind === "private" || w.originalProfileId));
  }
  assert.ok(S().windows[id], "the private window stays in this renderer's memory");
});

test("every regular profile switches and moves in place, isolated or sharing data", () => {
  const { work, shared } = regularSession();
  assert.equal(S().profiles[shared].dataId, "default", "the side profile shares the default profile's data");
  const before = S().windowOrder.length;
  S().switchProfile("main", shared);
  assert.equal(S().windows.main.profileId, shared);
  S().switchProfile("main", work);
  assert.equal(S().windows.main.profileId, work, "an isolated profile pages in place");
  assert.equal(S().windowOrder.length, before, "no window opens for the isolated profile");
  S().switchProfile("main", "default");
  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://move.test/" } } }));
  S().moveTabToProfile(tab, work);
  assert.equal(S().tabs[tab].windowId, "main", "the moved tab stays in its window");
  assert.equal(S().tabs[tab].profileId, work);
  assert.equal(S().windowOrder.length, before);
});

test("the native host follows the window's engine profile, once per engine change and in order", async () => {
  const { work, shared } = regularSession();
  const { watchActiveProfile } = await import("./hostWindowProfiles.ts");
  const host = fakeHost();
  const stop = watchActiveProfile(host, useBrowser);
  S().switchProfile("main", shared);
  S().switchProfile("main", work);
  S().switchProfile("main", "default");
  await tick();
  stop();
  assert.deepEqual(host.calls.filter(([method]) => method === "ArdiaShell.setActiveProfile").map(([, { args }]) => args),
    [["", 1], [work, 2], ["", 3]], "sharing profiles keep the engine profile, so only engine changes reach the host");
});

test("a private window never reports an active engine profile", async () => {
  regularSession();
  const { activeEngineProfile } = await import("./hostWindowProfiles.ts");
  const id = S().createWindow({ kind: "private", background: true });
  assert.equal(activeEngineProfile(S(), id), undefined);
  assert.equal(activeEngineProfile(S(), "main"), "");
});

test("an isolated-profile window lists its own profile's downloads", async () => {
  const { startHostDownloads } = await import("./hostDownloads.ts");
  const { downloadVisibleIn } = await import("../../browser/src/state/downloads/downloadsSlice.ts");
  const listed = { id: "3f2504e0-4f89-41d3-9a0c-000000000001", url: "https://example.test/1", filename: "1.zip", path: "/home/me/Downloads/1.zip",
    state: "finished", paused: false, received: 1, total: 1, speed: 0, mimeType: "application/zip" };
  const run = async (pageProfile) => {
    const host = { bootstrap: { windowId: "w-work", profileId: "default", pageProfile }, call: async () => JSON.stringify([listed]), invoke: async () => null, onEvent: () => () => {} };
    const state = { downloads: [], removeDownload() {}, clearDownloads() {} };
    const running = startHostDownloads(host, { getState: () => state, setState: (patch) => Object.assign(state, patch) });
    await running.ready;
    running.stop();
    return state.downloads;
  };
  const isolated = await run("p-work");
  assert.equal(isolated.length, 1);
  assert.equal(isolated[0].profile, "p-work");
  assert.ok(downloadVisibleIn({ profiles: {} }, isolated[0], { kind: "main", profileId: "p-work" }));
  assert.ok(!downloadVisibleIn({ profiles: {} }, isolated[0], { kind: "main", profileId: "default" }));
  const regular = await run("");
  assert.equal(regular[0].profile, "");
  assert.ok(downloadVisibleIn({ profiles: {} }, regular[0], { kind: "main", profileId: "default" }));
});

test("a refused window leaves the store without closed-window history", quiet(async () => {
  const { work } = regularSession();
  const host = fakeHost({ pending: true });
  const open = createHostWindowOpener(host, () => S(), () => {}, (id) => dropRefusedWindow(useBrowser, id));
  const closedWindows = S().closedWindows;
  const closedTabs = S().closedTabs;
  const created = S().createWindow({ profileId: work, background: true });
  await open(created, { profile: work });
  await tick();
  assert.ok(S().windows[created]);
  host.native({ type: "refused", id: created });
  await tick();
  assert.equal(S().windows[created], undefined, "the refused window leaves the store");
  assert.equal(S().closedWindows, closedWindows, "no Reopen Closed Window entry for a window that never opened");
  assert.equal(S().closedTabs, closedTabs);
  assert.equal(pendingOpenings(), 0);
}));

test("an opening settles only once its own window attaches", quiet(async () => {
  const { work } = regularSession();
  const host = fakeHost({ pending: true });
  const open = createHostWindowOpener(host, () => S(), () => {}, (id) => dropRefusedWindow(useBrowser, id));
  const created = S().createWindow({ profileId: work, background: true });
  const opened = windowOpened(created);
  await open(created, { profile: work });
  host.native({ type: "attached", id: "someone-else" });
  await tick();
  assert.equal(pendingOpenings(), 1);
  host.native({ type: "attached", id: created });
  assert.equal(await opened, true);
  assert.equal(pendingOpenings(), 0, "settled openings are removed");
}));

test("an opening settled before anyone waits leaves nothing behind", quiet(async () => {
  const host = fakeHost();
  await createHostWindowOpener(host, () => ({ windows: {}, tabs: {} }), () => {})("w-unwatched", { profile: "" });
  assert.equal(pendingOpenings(), 0);
  const waiting = windowOpened("w-waits");
  assert.equal(pendingOpenings(), 1);
  await createHostWindowOpener(host, () => ({ windows: {}, tabs: {} }), () => {})("w-waits", { profile: "" });
  assert.equal(await waiting, true);
  assert.equal(pendingOpenings(), 0);
}));
