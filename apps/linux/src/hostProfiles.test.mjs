import assert from "node:assert/strict";
import test from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { engineProfile } from "../../browser/src/state/browser/model.ts";
import { initialHostSession, snapshotHostSession, startHostPersistence } from "./hostSession.ts";
import { createHostWindowOpener, dropRefusedWindow, installProfileWindows, pendingOpenings, privateWindowSeed, profileWindowFor, windowOpened, withPrivateWindow } from "./hostWindowProfiles.ts";

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

test("an isolated profile opens in its own native window while shared-data profiles switch in place", () => {
  const { work, shared } = regularSession();
  assert.equal(S().profiles[shared].dataId, "default", "the side profile shares the default profile's data");
  const focused = [];
  installProfileWindows(useBrowser, (id) => focused.push(id));
  const before = S().windowOrder.length;
  S().switchProfile("main", shared);
  assert.equal(S().windows.main.profileId, shared, "a profile sharing the window's data switches in place");
  assert.equal(S().windowOrder.length, before);
  S().switchProfile("main", "default");

  S().switchProfile("main", work);
  assert.equal(S().windows.main.profileId, "default", "the default-profile window never hosts the isolated profile");
  assert.equal(S().windowOrder.length, before + 1);
  const workWindow = S().windowOrder.find((id) => S().windows[id].profileId === work);
  assert.ok(workWindow);
  assert.ok(S().windows[workWindow].tabIds.every((t) => S().tabs[t].profileId === work));
  assert.equal(profileWindowFor(S(), work), workWindow);

  S().switchProfile("main", work);
  assert.equal(S().windowOrder.length, before + 1, "an existing window for that profile is reused");
  assert.deepEqual(focused, [workWindow]);

  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://move.test/" } } }));
  S().moveTabToProfile(tab, work);
  assert.equal(S().tabs[tab], undefined, "the source tab leaves the default-profile window");
  const moved = Object.values(S().tabs).find((t) => t.url === "https://move.test/");
  assert.ok(moved && moved.profileId === work && moved.windowId !== "main");
  assert.ok(Object.values(S().windows).every((w) => w.kind === "private" || w.tabIds.every((t) => engineProfile(S(), S().tabs[t].profileId) === engineProfile(S(), w.profileId))),
    "every regular window keeps one engine profile");
});

test("moving a tab to an isolated profile keeps the tab when that profile's window cannot open", quiet(async () => {
  const { work } = regularSession();
  installProfileWindows(useBrowser, () => {});
  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://keep.test/" } } }));
  const host = fakeHost({ reject: "Chrome could not open this profile" });
  const events = [];
  const open = createHostWindowOpener(host, () => S(), (event) => {
    events.push(event);
    if (event.type === "close") S().closeWindow(event.id);
  });
  const before = new Set(S().windowOrder);
  S().moveTabToProfile(tab, work);
  const created = S().windowOrder.find((id) => !before.has(id));
  assert.ok(created, "a window for the isolated profile is requested");
  await open(created, { profile: work });
  await tick();
  assert.deepEqual(events, [{ type: "close", id: created }]);
  assert.equal(S().windows[created], undefined);
  assert.ok(S().tabs[tab], "the source tab survives a failed move");
  assert.equal(S().tabs[tab].profileId, "default");
  assert.equal(S().tabs[tab].url, "https://keep.test/");
}));

test("moving a tab to an isolated profile closes the source only after its window opens", quiet(async () => {
  const { work } = regularSession();
  installProfileWindows(useBrowser, () => {});
  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://move.test/" } } }));
  const open = createHostWindowOpener(fakeHost(), () => S(), () => {});
  const before = new Set(S().windowOrder);
  S().moveTabToProfile(tab, work);
  const created = S().windowOrder.find((id) => !before.has(id));
  assert.ok(S().tabs[tab], "the source waits for the target window");
  await open(created, { profile: work });
  await tick();
  assert.equal(S().tabs[tab], undefined);
  assert.ok(Object.values(S().tabs).some((t) => t.windowId === created && t.profileId === work && t.url === "https://move.test/"));
}));

test("moving a tab to an isolated profile reuses that profile's open window", () => {
  const { work } = regularSession();
  const focused = [];
  installProfileWindows(useBrowser, (id) => focused.push(id));
  const workWindow = S().createWindow({ profileId: work, background: true });
  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://reuse.test/" } } }));
  const windows = S().windowOrder.length;
  S().moveTabToProfile(tab, work);
  assert.equal(S().windowOrder.length, windows, "no new window");
  assert.equal(S().tabs[tab], undefined);
  const moved = S().windows[workWindow].tabIds.map((id) => S().tabs[id]).find((t) => t.url === "https://reuse.test/");
  assert.ok(moved && moved.profileId === work);
  assert.deepEqual(focused, [workWindow]);
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

test("a refused window leaves the store without closed-window history and its move keeps the source", quiet(async () => {
  const { work } = regularSession();
  installProfileWindows(useBrowser, () => {});
  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://refused.test/" } } }));
  const host = fakeHost({ pending: true });
  const open = createHostWindowOpener(host, () => S(), () => {}, (id) => dropRefusedWindow(useBrowser, id));
  const closedWindows = S().closedWindows;
  const closedTabs = S().closedTabs;
  const before = new Set(S().windowOrder);
  S().moveTabToProfile(tab, work);
  const created = S().windowOrder.find((id) => !before.has(id));
  await open(created, { profile: work });
  await tick();
  assert.ok(S().tabs[tab], "a pending window does not yet confirm the move");
  assert.ok(S().windows[created]);
  host.native({ type: "refused", id: created });
  await tick();
  assert.equal(S().windows[created], undefined, "the refused window leaves the store");
  assert.equal(S().closedWindows, closedWindows, "no Reopen Closed Window entry for a window that never opened");
  assert.equal(S().closedTabs, closedTabs);
  assert.ok(S().tabs[tab], "the source tab survives the refusal");
  assert.equal(pendingOpenings(), 0);
}));

test("a cross-profile move closes its source only once the target window attaches", quiet(async () => {
  const { work } = regularSession();
  installProfileWindows(useBrowser, () => {});
  const tab = S().windows.main.tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://attached.test/" } } }));
  const host = fakeHost({ pending: true });
  const open = createHostWindowOpener(host, () => S(), () => {}, (id) => dropRefusedWindow(useBrowser, id));
  const before = new Set(S().windowOrder);
  S().moveTabToProfile(tab, work);
  const created = S().windowOrder.find((id) => !before.has(id));
  await open(created, { profile: work });
  host.native({ type: "attached", id: "someone-else" });
  await tick();
  assert.ok(S().tabs[tab]);
  host.native({ type: "attached", id: created });
  await tick();
  assert.equal(S().tabs[tab], undefined);
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
