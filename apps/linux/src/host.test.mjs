import assert from "node:assert/strict";
import test from "node:test";
import { callHost, invokeHost } from "./host.ts";
import { resolveHostModule } from "./hostModules.ts";
import { createHostDocuments } from "./hostDocuments.ts";
import { createSessionWriter, initialHostSession, snapshotHostSession, startHostPersistence } from "./hostSession.ts";
import { HostTab } from "./hostTab.ts";
import { tabViewport, watchTabViewport } from "./hostViewport.ts";
import { startHostTabLifecycle } from "./hostTabLifecycle.ts";
import { startHostData } from "./hostData.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { adoptParkedPins } from "../../browser/src/state/pins/parkedPins.ts";
import { splitTabIds } from "../../browser/src/state/splits/splits.ts";
import { reloadBookmarks } from "../../browser/src/state/bookmarks/engineSync.ts";
import { reloadHistory } from "../../browser/src/state/history/engineSync.ts";
import * as native from "../../browser/src/test-native/index.ts";

function fixture(invoke = async () => null) {
  const listeners = new Set();
  const requests = [];
  const host = {
    bootstrap: { windowId: "w_linux", profileId: "default" },
    call: async (...args) => { requests.push(["call", args]); return '{"ok":true}'; },
    invoke: async (method, args) => { requests.push([method, args]); return invoke(method, args); },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { host, requests, listeners, emit: (id, event) => { for (const listener of listeners) listener("ArdiaWebView", String(id), event); } };
}

test("engine transport preserves JSON and translates the empty default profile to its host ID", async () => {
  const { host, requests } = fixture();
  assert.equal(await callHost("history.query", "", '{"query":"linux"}', host), '{"ok":true}');
  assert.deepEqual(requests, [["call", ["history.query", "default", '{"query":"linux"}']]]);
  await callHost("history.query", "work", null, host);
  assert.deepEqual(requests.at(-1), ["call", ["history.query", "work", null]]);
});

test("unknown methods reject, and a shell method the host advertises replaces the Linux fallback", async () => {
  const { host } = fixture(async (method) => { throw new Error(`Unsupported: ${method}`); });
  await assert.rejects(resolveHostModule(host, "ArdiaTabs", "futureMethod")(7), /Unsupported: ArdiaTabs.futureMethod/);
  assert.equal(await resolveHostModule(host, "ArdiaShell", "dragPreviewBegin")(true), undefined);
  host.bootstrap.capabilities = ["ArdiaShell.dragPreviewBegin"];
  await assert.rejects(resolveHostModule(host, "ArdiaShell", "dragPreviewBegin")(true), /Unsupported/);
  assert.equal(resolveHostModule(host, "ArdiaTranslate", "available"), false);
  assert.equal(resolveHostModule(host, "ArdiaCalendar", "authorizationStatus")(), "restricted");
  await assert.rejects(invokeHost("missing", {}, undefined), /host unavailable/);
});

test("module dispatch keeps the named module and argument list", async () => {
  const { host, requests } = fixture();
  await resolveHostModule(host, "ArdiaShell", "openWindow")("w_linux", { profile: "default" });
  assert.deepEqual(requests, [["ArdiaShell.openWindow", { args: ["w_linux", { profile: "default" }] }]]);
});

test("documents read their native bootstrap and persist writes and removals in order", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { host, requests } = fixture(async (method) => method.endsWith("writeDocument") ? pending : null);
  host.bootstrap.documents = { "settings.json": '{"theme":"dark"}' };
  const documents = createHostDocuments(host);
  assert.equal(documents.read("settings.json"), '{"theme":"dark"}');
  const write = documents.write("settings.json", '{"theme":"light"}');
  assert.equal(documents.read("settings.json"), '{"theme":"light"}');
  const remove = documents.remove("settings.json");
  assert.equal(documents.read("settings.json"), null);
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  finish();
  await Promise.all([write, remove]);
  assert.equal(documents.read("settings.json"), null);
  assert.deepEqual(requests.map(([method]) => method), ["ArdiaShell.writeDocument", "ArdiaShell.removeDocument"]);
});

test("documents read back a write or removal before the native write finishes and roll back a failed one", async () => {
  let fail;
  const pending = new Promise((_, reject) => { fail = reject; });
  const { host } = fixture(async (method, args) => method.endsWith("writeDocument") && args.args[1] === '{"step":"failed"}' ? pending : null);
  host.bootstrap.documents = { "onboarding.json": '{"startedAt":1}' };
  const documents = createHostDocuments(host);
  const started = documents.write("onboarding.json", '{"startedAt":2}');
  assert.equal(documents.read("onboarding.json"), '{"startedAt":2}');
  await started;
  const removed = documents.remove("onboarding.json");
  assert.equal(documents.read("onboarding.json"), null);
  await removed;
  const failed = documents.write("onboarding.json", '{"step":"failed"}');
  assert.equal(documents.read("onboarding.json"), '{"step":"failed"}');
  fail(new Error("disk full"));
  await assert.rejects(failed, /disk full/);
  assert.equal(documents.read("onboarding.json"), null);
});

test("an isolated profile's new window seeds itself in that profile before the session that opened it is saved", () => {
  const { host } = fixture();
  host.bootstrap = { windowId: "w-isolated", profileId: "default", pageProfile: "p-isolated", startup: false };
  const saved = {
    profiles: { default: { id: "default", name: "Personal" }, "p-isolated": { id: "p-isolated", name: "Work" } },
    profileOrder: ["default", "p-isolated"],
    windows: { w_linux: { id: "w_linux", profileId: "default", incognito: false, tabIds: [], activeTabIds: {} } },
    windowOrder: ["w_linux"], tabs: {},
  };
  const session = initialHostSession(host, saved, 100);
  const w = session.windows["w-isolated"];
  assert.equal(w.profileId, "p-isolated");
  assert.deepEqual(w.tabIds.map((id) => session.tabs[id].profileId), ["p-isolated"]);
  assert.deepEqual(Object.keys(w.activeTabIds), ["p-isolated"]);
});

test("new host sessions use native IDs and contain no demo URLs", () => {
  const { host } = fixture();
  const session = initialHostSession(host, null, 100);
  assert.deepEqual(session.windowOrder, ["w_linux"]);
  assert.deepEqual(session.profileOrder, ["default"]);
  const tab = Object.values(session.tabs)[0];
  assert.equal(tab.url, "");
  assert.equal(tab.profileId, "default");
  assert.equal(session.focusedWindowId, "w_linux");
  assert.equal(initialHostSession(host, session).tabs[tab.id].id, tab.id);
  assert.throws(() => initialHostSession({ bootstrap: { windowId: "w", profileId: "/tmp/profile" } }, null), /Invalid/);
});

test("restore-disabled sessions park pinned tabs and groups and retain ordinary tabs only as recently closed", () => {
  const { host } = fixture();
  const saved = initialHostSession(host, null, 100);
  const template = Object.values(saved.tabs)[0];
  const make = (id, url, pinned = false) => ({ ...template, id, url, title: id, pin: pinned ? { as: "tile" } : null, pinnedUrl: pinned ? url : null });
  saved.tabs = {
    tile: make("tile", "https://pinned.example", true),
    grouped: make("grouped", "https://grouped.example"),
    regular: make("regular", "https://ordinary.example"),
  };
  saved.windows.w_linux = { ...saved.windows.w_linux, tabIds: ["tile", "grouped", "regular"], activeTabIds: { default: "regular" } };
  saved.groups = { pinnedGroup: { id: "pinnedGroup", windowId: "w_linux", profileId: "default", name: "Saved", pinned: true, tabIds: ["grouped"], createdAt: 100, collapsed: false, color: null, icon: null } };
  saved.settings = { restoreSession: false };
  const before = JSON.stringify(saved);
  const session = initialHostSession(host, saved, 200);
  assert.equal(JSON.stringify(saved), before);
  assert.deepEqual(Object.values(session.tabs).map((t) => t.url), [""]);
  assert.equal(session.closedWindows.length, 1);
  assert.deepEqual(session.closedWindows[0].tabs.map((t) => t.url), ["https://ordinary.example"]);
  assert.equal(session.closedWindows[0].tabs[0].active, true);
  assert.deepEqual(session.parkedPins.default.tabs.map((t) => t.url), ["https://pinned.example", "https://grouped.example"]);
  assert.deepEqual(session.groups, {});
  assert.deepEqual(session.splits, {});
  useBrowser.getState().hydrate(session);
  useBrowser.setState(adoptParkedPins(useBrowser.getState(), "w_linux", "default"));
  assert.deepEqual(Object.values(useBrowser.getState().tabs).map((t) => t.url).sort(), ["", "https://grouped.example", "https://pinned.example"]);
  assert.ok(Object.values(useBrowser.getState().tabs).filter((t) => t.url).every((t) => t.page.kind === "asleep"));
});

function browserState() {
  const { host } = fixture();
  const session = initialHostSession(host, null, 100);
  const publicTab = Object.values(session.tabs)[0];
  return {
    ...session,
    profiles: { ...session.profiles, "incognito:private": { id: "incognito:private" } },
    profileOrder: [...session.profileOrder, "incognito:private"],
    windows: { ...session.windows, private: { id: "private", kind: "private", profileId: "incognito:private", tabIds: ["secret"] } },
    windowOrder: [...session.windowOrder, "private"],
    tabs: { ...session.tabs, [publicTab.id]: { ...publicTab, page: { kind: "frozen", holderId: "other", wake: "restore:old" } }, secret: { id: "secret", windowId: "private", profileId: "incognito:private", url: "https://private.example", page: { kind: "idle" } } },
    ui: { focusOrder: ["private", "w_linux"], lastProfileId: "default" },
    peeks: {}, groups: {}, splits: {}, closedTabs: [{ tab: { profileId: "incognito:private" } }],
    closedWindows: [], closedGroups: [], deletedGroups: [], cleanedTabs: [],
    parkedPins: { "incognito:private": ["secret"] }, pinChoices: {}, pinSync: {}, settings: {}, orphanedProfileData: [],
  };
}

test("session snapshots omit private and transient state without mutating the store", () => {
  const state = browserState();
  const before = JSON.stringify(state);
  const saved = snapshotHostSession(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(saved.windows.private, undefined);
  assert.equal(saved.tabs.secret, undefined);
  assert.equal(saved.profiles["incognito:private"], undefined);
  assert.equal(saved.parkedPins["incognito:private"], undefined);
  assert.equal(saved.closedTabs.length, 0);
  assert.equal(saved.focusedWindowId, "w_linux");
  const tab = Object.values(saved.tabs)[0];
  assert.deepEqual(tab.page, { kind: "asleep" });
});

test("session writes serialize in-flight saves and coalesce queued snapshots", async () => {
  const { host, requests } = fixture();
  const writer = createSessionWriter(host);
  writer.queue({ focusedWindowId: "old" });
  writer.queue({ focusedWindowId: "current" });
  await writer.flush();
  await writer.flush();
  assert.deepEqual(requests, [["session.write", { base: {}, session: { focusedWindowId: "current" } }]]);
});

test("final flush dispatches synchronously and invalidates all older queued saves", async () => {
  const { host, requests } = fixture();
  const writer = createSessionWriter(host);
  writer.queue({ focusedWindowId: "stale" });
  const older = writer.flush();
  writer.queue({ focusedWindowId: "final" });
  const final = writer.flushFinal();
  assert.deepEqual(requests, [["session.write", { base: {}, session: { focusedWindowId: "final" } }]]);
  writer.queue({ focusedWindowId: "after-close" });
  await Promise.all([older, final, writer.flushFinal(), writer.flush()]);
  assert.equal(requests.length, 1);
});

test("final flush supersedes queued saves while preserving the order of requests already issued", async () => {
  let finish;
  const { host, requests } = fixture(async (_method, { session }) => session.focusedWindowId === "issued" ? new Promise((resolve) => { finish = resolve; }) : null);
  const writer = createSessionWriter(host);
  writer.queue({ focusedWindowId: "issued" });
  const issued = writer.flush();
  await new Promise(setImmediate);
  writer.queue({ focusedWindowId: "queued" });
  const queued = writer.flush();
  writer.queue({ focusedWindowId: "final" });
  const final = writer.flushFinal();
  assert.deepEqual(requests.map(([, { session }]) => session.focusedWindowId), ["issued", "final"]);
  finish();
  await Promise.all([issued, queued, final]);
  assert.deepEqual(requests.map(([, { session }]) => session.focusedWindowId), ["issued", "final"]);
});

function mutableStore(initial) {
  let state = initial;
  const listeners = new Set();
  const store = {
    getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (next) => {
      const previous = state;
      state = next;
      for (const listener of listeners) listener(state, previous);
    },
    setState: (patch) => store.set({ ...state, ...patch }),
  };
  return store;
}

test("before-close sends debounced changes once while transport is open and tolerates the canceled reply", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  const callbacks = new Set();
  let disposed = false;
  const { host, requests } = fixture(async () => {
    assert.equal(disposed, false);
    throw new Error("Ardia host closed");
  });
  host.onBeforeClose = (callback) => { callbacks.add(callback); return () => callbacks.delete(callback); };
  const store = mutableStore(browserState());
  const stop = startHostPersistence(host, store);
  try {
    store.set({ ...store.getState(), settings: { restoreSession: false } });
    for (const callback of callbacks) callback();
    disposed = true;
    assert.equal(requests.length, 1);
    assert.equal(requests[0][1].session.settings.restoreSession, false);
    window.dispatchEvent(new Event("pagehide"));
    stop();
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    assert.equal(callbacks.size, 0);
  } finally {
    stop();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("fixtures without before-close still synchronously flush on pagehide", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  const { host, requests } = fixture();
  const stop = startHostPersistence(host, mutableStore(browserState()));
  try {
    window.dispatchEvent(new Event("pagehide"));
    assert.equal(requests.length, 1);
    stop();
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
  } finally {
    stop();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("logical tab removal and pinned unload close once while native view unmount only detaches", async () => {
  const { host, requests } = fixture(async (method) => method === "tab.create" ? { browserId: 55, chromeTabId: 65 } : null);
  const state = browserState();
  const key = Object.keys(state.tabs).find((id) => id !== "secret");
  state.tabs[key] = { ...state.tabs[key], url: "https://example.com", page: { kind: "loaded", nav: { url: "https://example.com", seq: 1 } } };
  const store = mutableStore(state);
  const stop = startHostTabLifecycle(host, store);
  const view = new HostTab(host, { key }, () => {});
  await view.ready;
  view.dispose();
  await new Promise(setImmediate);
  assert.equal(requests.filter(([method]) => method === "tab.close").length, 0);
  store.set({ ...store.getState(), tabs: { ...store.getState().tabs, [key]: { ...store.getState().tabs[key], pin: { as: "tile" }, page: { kind: "asleep" } } } });
  await new Promise(setImmediate);
  assert.deepEqual(requests.filter(([method]) => method === "tab.close"), [["tab.close", { key }]]);
  const { [key]: _, ...tabs } = store.getState().tabs;
  store.set({ ...store.getState(), tabs });
  await new Promise(setImmediate);
  assert.equal(requests.filter(([method]) => method === "tab.close").length, 1);
  store.set({ ...state, tabs: { ...state.tabs, [key]: { ...state.tabs[key], page: { kind: "loaded", nav: { url: "https://example.com", seq: 2 } } } } });
  store.set({ ...store.getState(), tabs });
  await new Promise(setImmediate);
  assert.equal(requests.filter(([method]) => method === "tab.close").length, 2);
  stop();
});

test("window, profile, split and page-alias transfers preserve retained holder keys", async () => {
  const { host, requests } = fixture();
  const state = browserState();
  const key = Object.keys(state.tabs).find((id) => id !== "secret");
  const holder = { ...state.tabs[key], page: { kind: "loaded", nav: { url: "https://example.com", seq: 1 } } };
  const alias = { ...holder, id: "alias", page: { kind: "frozen", holderId: key } };
  const store = mutableStore({ tabs: { [key]: holder, alias } });
  const stop = startHostTabLifecycle(host, store);
  store.set({ tabs: { [key]: { ...holder, windowId: "other", profileId: "work" }, alias } });
  store.set({ tabs: { [key]: { ...holder, windowId: "other" } } });
  const moved = store.getState();
  store.set({ tabs: {} });
  store.set(moved);
  await new Promise(setImmediate);
  assert.equal(requests.filter(([method]) => method === "tab.close").length, 0);
  stop();
});

test("production shared-tab split transfers keep native pages while explicit closes remove their keys", async () => {
  useBrowser.getState().hydrate({});
  const s = () => useBrowser.getState();
  const a = s().createWindow({ url: "https://a.example" });
  const holder = s().windows[a].tabIds[0];
  const b = s().createWindow({ url: "https://b.example" });
  const other = s().windows[b].tabIds[0];
  s().updateSettings({ shareTabsAcrossWindows: true });
  const alias = s().windows[b].tabIds.find((key) => s().tabs[key].page.kind === "frozen" && s().tabs[key].page.holderId === holder);
  assert.ok(alias);
  const { host, requests } = fixture();
  const stop = startHostTabLifecycle(host, useBrowser);
  try {
    s().createSplit([other, alias]);
    await new Promise(setImmediate);
    assert.equal(s().tabs[holder].windowId, b);
    assert.ok(Object.values(s().splits).some((split) => splitTabIds(split).includes(holder)));
    assert.equal(requests.some(([method, args]) => method === "tab.close" && args.key === holder), false);
    s().closeTab(holder);
    await new Promise(setImmediate);
    assert.deepEqual(requests.filter(([method, args]) => method === "tab.close" && args.key === holder), [["tab.close", { key: holder }]]);
  } finally {
    stop();
  }
});

test("production data bridges persist bookmark edits in Chrome and load history and orphan cleanup", async () => {
  native.docs.clear();
  native.current.device = "host-data";
  native.bookmarkDbs.clear();
  native.historyDbs.clear();
  native.deletedProfileData.length = 0;
  const { host } = fixture();
  useBrowser.getState().hydrate(initialHostSession(host, null));
  native.chromeVisit("", "https://history.example", "From Chrome");
  const stop = startHostData();
  try {
    await Promise.all([reloadBookmarks(), reloadHistory()]);
    assert.equal(useBrowser.getState().history[""].list[0].url, "https://history.example");
    const bookmark = useBrowser.getState().addBookmark({ profileId: "default", url: "https://bookmark.example", title: "Persist me" });
    await reloadBookmarks();
    assert.equal(native.chromeBookmarks("").get(bookmark).u, "https://bookmark.example");
    useBrowser.setState({ orphanedProfileData: ["unused-profile"] });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.deepEqual(native.deletedProfileData, ["unused-profile"]);
    assert.deepEqual(useBrowser.getState().orphanedProfileData, []);
  } finally {
    stop();
  }
  useBrowser.getState().hydrate(initialHostSession(host, null));
  const again = startHostData();
  try {
    await reloadBookmarks();
    assert.ok(Object.values(useBrowser.getState().bookmarks.nodes).some((node) => node.url === "https://bookmark.example"));
  } finally {
    again();
  }
});

test("tab creation buffers early native events and reports real native IDs", async () => {
  let f;
  f = fixture(async (method) => {
    if (method === "tab.create") {
      f.emit(41, { type: "progress", progress: 0.5 });
      f.emit(42, { type: "title", title: "different tab" });
      return { browserId: 41, chromeTabId: 9 };
    }
    return null;
  });
  const events = [];
  const tab = new HostTab(f.host, { key: "tab", profile: "", url: "https://example.com" }, (event) => events.push(event));
  await tab.ready;
  assert.deepEqual(events.map((event) => event.type), ["ready", "progress"]);
  assert.equal(events[0].browserId, 41);
  assert.equal(events[0].chromeTabId, 9);
  await tab.command("goBack");
  assert.deepEqual(f.requests.at(-1), ["tab.command", { id: 41, claim: tab.claim, command: "goBack", args: [] }]);
  tab.dispose();
  await new Promise(setImmediate);
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.requests.at(-1), ["tab.release", { id: 41, claim: tab.claim }]);
  await assert.rejects(tab.command("reload"), /released/);
});

test("an unmount during create releases its late result without firing ready", async () => {
  let finish;
  const { host, requests } = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const events = [];
  const tab = new HostTab(host, { key: "pending" }, (event) => events.push(event));
  await new Promise(setImmediate);
  tab.dispose();
  finish({ browserId: 12, chromeTabId: 20 });
  await tab.ready;
  await new Promise(setImmediate);
  assert.deepEqual(events, []);
  assert.equal(requests.at(-1)[0], "tab.release");
});

test("a stale view cannot release the same tab after another view claims its transfer key", async () => {
  const { host, requests } = fixture(async () => ({ browserId: 17, chromeTabId: 8 }));
  const old = new HostTab(host, { key: "moved" }, () => {});
  await old.ready;
  const current = new HostTab(host, { key: "moved" }, () => {});
  await current.ready;
  await old.viewport({ rect: { x: 0, y: 0, width: 500, height: 500 }, visible: false });
  assert.equal(requests.filter(([method]) => method === "tab.viewport").length, 0);
  await assert.rejects(old.command("reload"), /released/);
  old.dispose();
  await new Promise(setImmediate);
  assert.equal(requests.filter(([method]) => method === "tab.release").length, 0);
  current.dispose();
  await new Promise(setImmediate);
  assert.equal(requests.filter(([method]) => method === "tab.release").length, 1);
});

test("viewports deduplicate geometry and send explicit visibility changes", async () => {
  const { host, requests } = fixture(async () => ({ browserId: 13, chromeTabId: 21 }));
  const tab = new HostTab(host, { key: "visible" }, () => {});
  await tab.ready;
  const viewport = tabViewport({ x: 240, y: 52, width: 800, height: 600 }, { width: 1200, height: 800 }, true);
  await tab.viewport(viewport);
  await tab.viewport(viewport);
  await tab.viewport({ ...viewport, visible: false });
  const updates = requests.filter(([method]) => method === "tab.viewport");
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0][1], { id: 13, claim: tab.claim, ...viewport });
  assert.equal(updates[1][1].visible, false);
  assert.equal(tabViewport({ x: -900, y: 0, width: 800, height: 600 }, { width: 1200, height: 800 }, true).visible, false);
  assert.equal(tabViewport({ x: NaN, y: 0, width: 800, height: 600 }, { width: 1200, height: 800 }, true).visible, false);
  tab.dispose();
});

test("logical tab presentations batch returns and departures independently of viewport coverage", async () => {
  let next = 20;
  const { host, requests } = fixture(async (method) => method === "tab.create" ? { browserId: ++next, chromeTabId: next } : null);
  const outgoing = new HostTab(host, { key: "outgoing" }, () => {});
  const incoming = new HostTab(host, { key: "incoming" }, () => {});
  await Promise.all([outgoing.ready, incoming.ready]);
  await Promise.all([outgoing.presentation(true), incoming.presentation(false)]);
  const baseline = requests.filter(([method]) => method === "tab.presentations").length;
  await outgoing.viewport({ rect: { x: 10, y: 20, width: 500, height: 300 }, visible: false });
  assert.equal(requests.filter(([method]) => method === "tab.presentations").length, baseline);
  await Promise.all([outgoing.presentation(false), incoming.presentation(true)]);
  assert.deepEqual(requests.filter(([method]) => method === "tab.presentations").at(-1), ["tab.presentations", { tabs: [{ claim: outgoing.claim, id: 21, visible: false }, { claim: incoming.claim, id: 22, visible: true }] }]);
  outgoing.dispose();
  incoming.dispose();
});

test("presentations retain queue order across pending replacements and ignore released views", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { host, requests } = fixture(async (method) => method === "tab.create" ? pending : null);
  const old = new HostTab(host, { key: "moving" }, () => {});
  const oldUpdate = old.presentation(false);
  const current = new HostTab(host, { key: "moving" }, () => {});
  const currentUpdate = current.presentation(true);
  assert.equal(requests.filter(([method]) => method === "tab.presentations").length, 0);
  finish({ browserId: 30, chromeTabId: 30 });
  await Promise.all([oldUpdate, currentUpdate]);
  assert.deepEqual(requests.filter(([method]) => method === "tab.presentations"), [["tab.presentations", { tabs: [{ claim: old.claim, id: 30, visible: false }] }], ["tab.presentations", { tabs: [{ claim: current.claim, id: 30, visible: true }] }]]);
  const releasedUpdate = current.presentation(false);
  current.dispose();
  old.dispose();
  await releasedUpdate;
  assert.equal(requests.filter(([method]) => method === "tab.presentations").length, 2);
});

test("a presentation batch retains its final visibility and reports transport errors", async () => {
  const { host, requests } = fixture(async (method) => {
    if (method === "tab.create") return { browserId: 31, chromeTabId: 31 };
    if (method === "tab.presentations") throw new Error("presentation failed");
    return null;
  });
  const tab = new HostTab(host, { key: "rapid" }, () => {});
  await tab.ready;
  const results = await Promise.allSettled([tab.presentation(false), tab.presentation(true)]);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason.message === "presentation failed"));
  assert.deepEqual(requests.filter(([method]) => method === "tab.presentations"), [["tab.presentations", { tabs: [{ claim: tab.claim, id: 31, visible: true }] }]]);
  tab.dispose();
});

test("viewport observation tracks transforms, scroll, visual zoom, overlays, and document visibility", () => {
  const previous = Object.fromEntries(["window", "document", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, globalThis[key]]));
  const windowEvents = new EventTarget();
  const visualViewport = new EventTarget();
  const documentEvents = new EventTarget();
  let rect = { x: 200, y: 50, width: 800, height: 600, left: 200, top: 50, right: 1000, bottom: 650 };
  let frame;
  let blocked = false;
  let disconnected = false;
  const element = { isConnected: true, parentElement: null, getBoundingClientRect: () => rect, contains: () => false };
  const document = Object.assign(documentEvents, { hidden: false, querySelectorAll: () => [], querySelector: () => null, elementFromPoint: () => blocked ? {} : element });
  globalThis.window = Object.assign(windowEvents, { innerWidth: 1280, innerHeight: 800, visualViewport });
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected = true; } };
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  const updates = [];
  try {
    const stop = watchTabViewport(element, () => true, (update) => updates.push(update));
    assert.equal(updates.at(-1).visible, true);
    rect = { ...rect, x: 250, left: 250, right: 1050 };
    windowEvents.dispatchEvent(new Event("scroll"));
    assert.equal(updates.at(-1).rect.x, 250);
    rect = { ...rect, width: 720, right: 970 };
    visualViewport.dispatchEvent(new Event("resize"));
    assert.equal(updates.at(-1).rect.width, 720);
    blocked = true;
    frame();
    assert.equal(updates.at(-1).visible, false);
    blocked = false;
    document.hidden = true;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates.at(-1).visible, false);
    document.hidden = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates.at(-1).visible, true);
    stop();
    assert.equal(disconnected, true);
    const count = updates.length;
    windowEvents.dispatchEvent(new Event("scroll"));
    assert.equal(updates.length, count);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
