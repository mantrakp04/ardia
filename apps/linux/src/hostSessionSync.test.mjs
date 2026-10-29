import assert from "node:assert/strict";
import test from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { createSessionWriter, initialHostSession, snapshotHostSession, startHostPersistence } from "./hostSession.ts";
import { cloneSessionValue, mergeSession } from "./hostSessionMerge.ts";
import { sessionStatePatch } from "./hostSessionState.ts";

const tick = () => new Promise(setImmediate);

function sharedSession() {
  const a = { bootstrap: { windowId: "a", profileId: "default", startup: false } };
  const b = { bootstrap: { windowId: "b", profileId: "default", startup: false } };
  const initial = initialHostSession(b, initialHostSession(a, null));
  const aKey = initial.windows.a.tabIds[0];
  const bKey = initial.windows.b.tabIds[0];
  initial.tabs[aKey] = { ...initial.tabs[aKey], url: "A0", title: "A" };
  initial.tabs[bKey] = { ...initial.tabs[bKey], url: "B0", title: "B" };
  useBrowser.getState().hydrate(initial);
  return { initial: cloneSessionValue(snapshotHostSession(useBrowser.getState())), aKey, bKey };
}

function stateStore(session, windowId) {
  useBrowser.getState().hydrate(session);
  let state = { ...useBrowser.getState(), ui: { ...useBrowser.getState().ui, focusedWindowId: windowId, focusOrder: [windowId] } };
  state.tabs = Object.fromEntries(Object.entries(state.tabs).map(([key, tab]) => [key, { ...tab, lastActiveAt: session.tabs[key].lastActiveAt }]));
  const listeners = new Set();
  const store = {
    getState: () => state,
    setState: (patch) => {
      const previous = state;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state, previous);
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return store;
}

function nativeService(initial) {
  let canonical = cloneSessionValue(initial);
  const clients = [];
  const requests = [];
  const jobs = [];
  const service = {
    mode: "event-first",
    get session() { return canonical; },
    requests,
    jobs,
    broadcast(update) {
      for (const client of clients) if (!client.closed) for (const listener of client.listeners) listener("ArdiaHost", "session", cloneSessionValue(update));
    },
    external(change) {
      const base = canonical;
      canonical = change(cloneSessionValue(canonical));
      service.broadcast({ base, session: canonical, sourceWindowId: "external" });
    },
    client(windowId) {
      const client = { closed: false, listeners: new Set(), closing: new Set() };
      clients.push(client);
      return {
        bootstrap: { windowId, profileId: "default", startup: false, session: cloneSessionValue(initial) },
        onEvent: (listener) => { client.listeners.add(listener); return () => client.listeners.delete(listener); },
        onBeforeClose: (listener) => { client.closing.add(listener); return () => client.closing.delete(listener); },
        close() {
          for (const listener of client.closing) listener();
          client.closed = true;
        },
        invoke(method, pair) {
          assert.equal(client.closed, false);
          if (method === "session.read") return Promise.resolve(cloneSessionValue(canonical));
          assert.equal(method, "session.write");
          requests.push({ windowId, ...cloneSessionValue(pair) });
          const base = canonical;
          canonical = mergeSession(pair.base, pair.session, canonical);
          const response = cloneSessionValue(canonical);
          const update = { base, session: response, sourceWindowId: windowId };
          if (service.mode === "manual") return new Promise((resolve, reject) => jobs.push({ emit: () => service.broadcast(update), resolve: () => resolve(response), reject }));
          if (service.mode === "ack-first") setImmediate(() => service.broadcast(update));
          else service.broadcast(update);
          return Promise.resolve(response);
        },
      };
    },
  };
  return service;
}

function browserEvents() {
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}

async function flush() {
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  document.hidden = false;
  await tick();
  await tick();
}

function navigate(store, key, url) {
  const state = store.getState();
  store.setState({ tabs: { ...state.tabs, [key]: { ...state.tabs[key], url } } });
}

test("two independent session writers preserve both window URL changes against native canonical state", async () => {
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const a = createSessionWriter(native.client("a"), initial);
  const b = createSessionWriter(native.client("b"), initial);
  const localA = cloneSessionValue(initial);
  localA.tabs[aKey].url = "A1";
  a.queue(localA);
  await a.flush();
  const localB = cloneSessionValue(initial);
  localB.tabs[bKey].url = "B1";
  b.queue(localB);
  await b.flush();
  assert.equal(native.session.tabs[aKey].url, "A1");
  assert.equal(native.session.tabs[bKey].url, "B1");
  assert.equal(native.requests[1].base.tabs[aKey].url, "A0");
});

test("opening another renderer with restoration disabled preserves active windows", () => {
  const { initial, aKey } = sharedSession();
  initial.settings.restoreSession = false;
  const opened = initialHostSession({ bootstrap: { windowId: "new", profileId: "default", startup: false } }, initial);
  assert.equal(opened.tabs[aKey].url, "A0");
  assert.ok(opened.windows.a);
  assert.ok(opened.windows.b);
  assert.ok(opened.windows.new);
  assert.equal(opened.closedWindows.length, initial.closedWindows.length);
});

test("session patches preserve navigation, native window handles, live state, private records, and object references", () => {
  const { initial, aKey, bKey } = sharedSession();
  const store = stateStore(initial, "b");
  const page = { kind: "adopted", adopt: "tab:7", nav: { url: "active", seq: 99 } };
  const state = store.getState();
  state.tabs = { ...state.tabs, [aKey]: { ...state.tabs[aKey], page }, private: { ...state.tabs[bKey], id: "private", profileId: "incognito:private", windowId: "private" } };
  state.windows = { ...state.windows, a: { ...state.windows.a, chromeWindow: "native-a" }, private: { ...state.windows.b, id: "private", kind: "private", tabIds: ["private"] } };
  const local = snapshotHostSession(state);
  const merged = cloneSessionValue(local);
  merged.tabs[aKey].title = "remote";
  merged.windows.a.sidebarOpen = !merged.windows.a.sidebarOpen;
  const patch = sessionStatePatch(state, local, merged);
  assert.equal(patch.tabs[aKey].page, page);
  assert.equal(patch.tabs[bKey], state.tabs[bKey]);
  assert.equal(patch.tabs.private, state.tabs.private);
  assert.equal(patch.windows.a.chromeWindow, "native-a");
  assert.equal(patch.windows.private, state.windows.private);
  assert.equal(patch.live, undefined);
  assert.equal(patch.ui, undefined);
  const updated = { ...state, ...patch };
  assert.deepEqual(sessionStatePatch(updated, snapshotHostSession(updated), snapshotHostSession(updated)), {});
});

for (const order of ["event-first", "ack-first"]) {
  test(`global settings synchronize without echo saves or focus resets with ${order}`, async () => {
    const restore = browserEvents();
    const { initial } = sharedSession();
    const native = nativeService(initial);
    native.mode = order;
    const a = stateStore(initial, "a");
    const b = stateStore(initial, "b");
    assert.deepEqual(cloneSessionValue(snapshotHostSession(a.getState()).tabs), initial.tabs);
    assert.deepEqual(cloneSessionValue(snapshotHostSession(b.getState()).tabs), initial.tabs);
    const stopA = startHostPersistence(native.client("a"), a, initial);
    const stopB = startHostPersistence(native.client("b"), b, initial);
    try {
      await flush();
      const focus = b.getState().ui;
      const live = b.getState().live;
      a.setState({ settings: { ...a.getState().settings, appearance: "dark" } });
      await flush();
      assert.equal(b.getState().settings.appearance, "dark");
      assert.equal(b.getState().ui, focus);
      assert.equal(b.getState().live, live);
      const count = native.requests.length;
      await new Promise((resolve) => setTimeout(resolve, 330));
      assert.equal(native.requests.length, count, JSON.stringify(native.requests.map((request) => ({ windowId: request.windowId, baseFocus: request.base.focusedWindowId, focus: request.session.focusedWindowId, baseAppearance: request.base.settings.appearance, appearance: request.session.settings.appearance, changed: Object.keys(request.session).filter((key) => JSON.stringify(request.session[key]) !== JSON.stringify(request.base[key])), tabChanges: Object.entries(request.session.tabs).flatMap(([id, tab]) => [...new Set([...Object.keys(tab), ...Object.keys(request.base.tabs[id] ?? {})])].filter((key) => JSON.stringify(tab[key]) !== JSON.stringify(request.base.tabs[id]?.[key])).map((key) => ({ id, key, base: request.base.tabs[id]?.[key], local: tab[key] }))) }))));
    } finally {
      stopA(); stopB(); restore();
    }
  });
}

test("a real local activation timestamp delta saves once and then settles", async () => {
  const restore = browserEvents();
  const { initial, bKey } = sharedSession();
  const native = nativeService(initial);
  const a = stateStore(initial, "a");
  const b = stateStore(initial, "b");
  b.setState({ tabs: { ...b.getState().tabs, [bKey]: { ...b.getState().tabs[bKey], lastActiveAt: initial.tabs[bKey].lastActiveAt + 100 } } });
  const stopA = startHostPersistence(native.client("a"), a, initial);
  const stopB = startHostPersistence(native.client("b"), b, initial);
  try {
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 330));
    assert.equal(native.session.tabs[bKey].lastActiveAt, initial.tabs[bKey].lastActiveAt + 100);
    const count = native.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 330));
    assert.equal(native.requests.length, count);
  } finally {
    stopA(); stopB(); restore();
  }
});

test("queued B edit rebases coherently when A1 is replaced by canonical A2 before dispatch", async () => {
  const restore = browserEvents();
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const stop = startHostPersistence(native.client("b"), b, initial);
  try {
    await flush();
    native.external((session) => { session.tabs[aKey].url = "A1"; return session; });
    navigate(b, bKey, "B1");
    native.external((session) => { session.tabs[aKey].url = "A2"; return session; });
    assert.equal(b.getState().tabs[bKey].url, "B1");
    await flush();
    assert.equal(native.session.tabs[aKey].url, "A2");
    assert.equal(native.session.tabs[bKey].url, "B1");
    const last = native.requests.at(-1);
    assert.equal(last.base.tabs[aKey].url, "A2");
    assert.equal(last.session.tabs[aKey].url, "A2");
  } finally {
    stop(); restore();
  }
});

test("newer canonical events cannot be overwritten by older ACKs", async () => {
  const restore = browserEvents();
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const stop = startHostPersistence(native.client("b"), b, initial);
  try {
    await flush();
    native.mode = "manual";
    navigate(b, bKey, "B1");
    await flush();
    const issued = native.jobs.at(-1);
    issued.emit();
    native.external((session) => { session.tabs[aKey].url = "A2"; return session; });
    issued.resolve();
    await tick();
    navigate(b, bKey, "B2");
    await flush();
    assert.equal(native.requests.at(-1).base.tabs[aKey].url, "A2");
    assert.equal(native.session.tabs[aKey].url, "A2");
    assert.equal(native.session.tabs[bKey].url, "B2");
    native.jobs.at(-1).emit();
    native.jobs.at(-1).resolve();
    await tick();
  } finally {
    stop(); restore();
  }
});

test("ACK-before-event synchronizes remote leaves before another local snapshot is queued", async () => {
  const restore = browserEvents();
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const stop = startHostPersistence(native.client("b"), b, initial);
  try {
    await flush();
    native.mode = "manual";
    native.session.tabs[aKey].url = "A1";
    navigate(b, bKey, "B1");
    await flush();
    const issued = native.jobs.at(-1);
    issued.resolve();
    await tick();
    assert.equal(b.getState().tabs[aKey].url, "A1");
    navigate(b, bKey, "B2");
    issued.emit();
    await flush();
    assert.equal(native.session.tabs[aKey].url, "A1");
    assert.equal(native.session.tabs[bKey].url, "B2");
    native.jobs.at(-1).emit();
    native.jobs.at(-1).resolve();
    await tick();
  } finally {
    stop(); restore();
  }
});

test("window additions and removals synchronize while preserving another renderer's pending tab edit", async () => {
  const restore = browserEvents();
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const stop = startHostPersistence(native.client("b"), b, initial);
  try {
    await flush();
    navigate(b, bKey, "B1");
    native.external((session) => initialHostSession({ bootstrap: { windowId: "new", profileId: "default", startup: false } }, session));
    assert.ok(b.getState().windows.new);
    native.external((session) => {
      delete session.windows.a;
      delete session.tabs[aKey];
      session.windowOrder = session.windowOrder.filter((id) => id !== "a");
      return session;
    });
    await flush();
    assert.equal(native.session.windows.a, undefined);
    assert.equal(native.session.tabs[aKey], undefined);
    assert.ok(native.session.windows.new);
    assert.equal(native.session.tabs[bKey].url, "B1");
  } finally {
    stop(); restore();
  }
});

function withoutWindow(session, id) {
  const { [id]: gone, ...windows } = session.windows;
  for (const key of gone?.tabIds ?? []) delete session.tabs[key];
  return { ...session, windows, windowOrder: session.windowOrder.filter((windowId) => windowId !== id) };
}

test("a window its opener never saves stays out of the session and survives the opener's next write", async () => {
  const restore = browserEvents();
  const { initial, aKey } = sharedSession();
  const native = nativeService(initial);
  const seeded = initialHostSession({ bootstrap: { windowId: "small", profileId: "default", startup: false } }, initial);
  const store = stateStore(seeded, "small");
  const stop = startHostPersistence(native.client("small"), store, initial);
  try {
    await flush();
    assert.equal(native.session.windows.small, undefined);
    native.external((session) => { const opener = withoutWindow(session, "small"); opener.tabs[aKey].url = "A2"; return opener; });
    await flush();
    assert.ok(store.getState().windows.small);
    assert.equal(native.session.windows.small, undefined);
    assert.equal(native.session.tabs[aKey].url, "A2");
  } finally {
    stop(); restore();
  }
});

function openerSavesIsolatedWindow(initial) {
  const opener = cloneSessionValue(initial);
  opener.profiles["p-iso"] = { id: "p-iso", name: "Work", color: "blue", icon: null, createdAt: 1 };
  opener.profileOrder = [...opener.profileOrder, "p-iso"];
  opener.windows.iso = { id: "iso", profileId: "p-iso", incognito: false, tabIds: ["tab-3"], activeTabIds: { "p-iso": "tab-3" }, sidebarOpen: true, frame: null, createdAt: 1 };
  opener.windowOrder = [...opener.windowOrder, "iso"];
  opener.tabs["tab-3"] = { ...initial.tabs[initial.windows.a.tabIds[0]], id: "tab-3", windowId: "iso", profileId: "p-iso", url: "https://work.example/", title: "Work" };
  return (session) => mergeSession(initial, opener, session);
}

for (const saved of ["before its renderer subscribes", "after its renderer starts"]) {
  test(`an isolated window's stand-in yields to the window its opener saves ${saved}`, async () => {
    const restore = browserEvents();
    const { initial } = sharedSession();
    const native = nativeService(initial);
    const isoHost = { bootstrap: { windowId: "iso", profileId: "default", pageProfile: "p-iso", startup: false } };
    const seeded = initialHostSession(isoHost, initial);
    assert.equal(seeded.windows.iso.profileId, "p-iso");
    const store = stateStore(seeded, "iso");
    const openerSave = openerSavesIsolatedWindow(initial);
    if (saved.startsWith("before")) native.external(openerSave);
    const stop = startHostPersistence(native.client("iso"), store, initial);
    try {
      await flush();
      if (!saved.startsWith("before")) {
        assert.equal(native.session.windows.iso, undefined);
        assert.equal(native.session.profiles["p-iso"], undefined);
        native.external(openerSave);
        await flush();
      }
      const state = store.getState();
      assert.deepEqual(state.windows.iso.tabIds, ["tab-3"]);
      assert.deepEqual(state.windows.iso.activeTabIds, { "p-iso": "tab-3" });
      assert.equal(state.tabs["tab-3"].profileId, "p-iso");
      assert.equal(state.profiles["p-iso"].name, "Work");
      assert.deepEqual(native.session.windows.iso.tabIds, ["tab-3"]);
      assert.equal(native.session.profiles["p-iso"].name, "Work");
      assert.ok(Object.values(native.session.tabs).every((tab) => tab.windowId !== "iso" || tab.id === "tab-3"));
    } finally {
      stop(); restore();
    }
  });
}

test("final pending write uses a coherent latest canonical pair and invalidates an older queued snapshot", async () => {
  const restore = browserEvents();
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const host = native.client("b");
  const stop = startHostPersistence(host, b, initial);
  try {
    await flush();
    native.mode = "manual";
    navigate(b, bKey, "B1");
    await flush();
    const issued = native.jobs.at(-1);
    navigate(b, bKey, "B2");
    await flush();
    native.external((session) => { session.tabs[aKey].url = "A2"; return session; });
    const count = native.requests.length;
    host.close();
    assert.equal(native.requests.length, count + 1);
    assert.equal(native.requests.at(-1).base.tabs[aKey].url, "A2");
    assert.equal(native.session.tabs[aKey].url, "A2");
    assert.equal(native.session.tabs[bKey].url, "B2");
    issued.resolve();
    native.jobs.at(-1).reject(new Error("The browser UI has closed"));
    await tick();
    assert.equal(native.requests.length, count + 1);
  } finally {
    stop(); restore();
  }
});

test("merged closed windows keep closing order and the reopen bound however the merge ordered them", async () => {
  const restore = browserEvents();
  const { initial } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const stop = startHostPersistence(native.client("b"), b, initial);
  const entry = (id, closedAt) => ({ kind: "window", id, window: { profileId: "default", sidebarOpen: true, frame: null }, tabs: [{ url: `https://${id}.test/`, title: id, profileId: "default", active: true }], groups: [], closedAt });
  try {
    await flush();
    native.external((session) => ({ ...session, closedWindows: [entry("cw-later", 200), entry("cw-earlier", 100)] }));
    assert.deepEqual(b.getState().closedWindows.map((c) => c.id), ["cw-earlier", "cw-later"]);
    native.external((session) => ({ ...session, closedWindows: Array.from({ length: 12 }, (_, i) => entry(`cw-${i}`, 1000 - i)) }));
    assert.deepEqual(b.getState().closedWindows.map((c) => c.closedAt), Array.from({ length: 10 }, (_, i) => 991 + i));
  } finally {
    stop(); restore();
  }
});

test("a cold launch restores closed windows in closing order", () => {
  const saved = initialHostSession({ bootstrap: { windowId: "a", profileId: "default", startup: false } }, null);
  const entry = (id, closedAt) => ({ kind: "window", id, window: { profileId: "default", sidebarOpen: true, frame: null }, tabs: [{ url: `https://${id}.test/`, title: id, profileId: "default", active: true }], groups: [], closedAt });
  const session = initialHostSession({ bootstrap: { windowId: "b", profileId: "default", startup: true } }, { ...saved, closedWindows: [entry("cw-later", 200), entry("cw-earlier", 100)] });
  assert.deepEqual(session.closedWindows.map((c) => c.id), ["cw-earlier", "cw-later"]);
});
