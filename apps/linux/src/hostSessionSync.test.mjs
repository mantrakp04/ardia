import assert from "node:assert/strict";
import test from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { createSessionWriter, initialHostSession, snapshotHostSession, startHostPersistence } from "./hostSession.ts";
import { cloneSessionValue, mergeSession } from "./hostSessionMerge.ts";

const tick = () => new Promise(setImmediate);
const hostFor = (windowId, startup = false) => ({ bootstrap: { windowId, profileId: "default", startup } });

function sharedSession() {
  const initial = initialHostSession(hostFor("b"), initialHostSession(hostFor("a"), null));
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
  return {
    getState: () => state,
    setState: (patch) => {
      const previous = state;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state, previous);
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
}

function nativeService(initial) {
  let canonical = cloneSessionValue(initial);
  const listeners = new Set();
  const service = {
    manual: false,
    get session() { return canonical; },
    requests: [],
    jobs: [],
    broadcast: (update) => { for (const listener of listeners) listener("ArdiaHost", "session", cloneSessionValue(update)); },
    external(change) {
      const base = canonical;
      canonical = change(cloneSessionValue(canonical));
      service.broadcast({ base, session: canonical, sourceWindowId: "external" });
    },
    client: (windowId) => ({
      bootstrap: { windowId, profileId: "default", startup: false, session: cloneSessionValue(initial) },
      onEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
      onBeforeClose: () => () => {},
      invoke(method, pair) {
        if (method === "session.read") return Promise.resolve(cloneSessionValue(canonical));
        service.requests.push({ windowId, ...cloneSessionValue(pair) });
        const base = canonical;
        canonical = mergeSession(pair.base, pair.session, canonical);
        const response = cloneSessionValue(canonical);
        const update = { base, session: response, sourceWindowId: windowId };
        if (service.manual) return new Promise((resolve) => service.jobs.push({ emit: () => service.broadcast(update), resolve: () => resolve(response) }));
        service.broadcast(update);
        return Promise.resolve(response);
      },
    }),
  };
  return service;
}

async function withBrowserEvents(run) {
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
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

test("two independent session writers preserve both windows' URL changes against native canonical state", async () => {
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  for (const [windowId, key, url] of [["a", aKey, "A1"], ["b", bKey, "B1"]]) {
    const writer = createSessionWriter(native.client(windowId), initial);
    const local = cloneSessionValue(initial);
    local.tabs[key].url = url;
    writer.queue(local);
    await writer.flush();
  }
  assert.equal(native.session.tabs[aKey].url, "A1");
  assert.equal(native.session.tabs[bKey].url, "B1");
  assert.equal(native.requests[1].base.tabs[aKey].url, "A0");
});

test("global settings reach the other window without echo saves or focus resets", () => withBrowserEvents(async () => {
  const { initial } = sharedSession();
  const native = nativeService(initial);
  const a = stateStore(initial, "a");
  const b = stateStore(initial, "b");
  const stops = [startHostPersistence(native.client("a"), a, initial), startHostPersistence(native.client("b"), b, initial)];
  try {
    await flush();
    const focus = b.getState().ui;
    a.setState({ settings: { ...a.getState().settings, appearance: "dark" } });
    await flush();
    assert.equal(b.getState().settings.appearance, "dark");
    assert.equal(b.getState().ui, focus);
    const count = native.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 330));
    assert.equal(native.requests.length, count);
  } finally {
    for (const stop of stops) stop();
  }
}));

test("newer canonical events cannot be overwritten by older ACKs", () => withBrowserEvents(async () => {
  const { initial, aKey, bKey } = sharedSession();
  const native = nativeService(initial);
  const b = stateStore(initial, "b");
  const stop = startHostPersistence(native.client("b"), b, initial);
  try {
    await flush();
    native.manual = true;
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
    stop();
  }
}));

test("only the launch window takes over the last focused saved window", () => {
  let session = initialHostSession(hostFor("window-9"), initialHostSession(hostFor("window-7"), null));
  const [aKey] = session.windows["window-7"].tabIds;
  session = { ...session, focusedWindowId: "window-7" };
  const launched = initialHostSession(hostFor("main", true), session);
  assert.deepEqual(launched.windowOrder, ["main", "window-9"]);
  assert.deepEqual(launched.windows.main.tabIds, [aKey]);
  assert.equal(launched.tabs[aKey].windowId, "main");
  const opened = initialHostSession(hostFor("window-12"), session);
  assert.deepEqual(Object.keys(opened.windows).sort(), ["window-12", "window-7", "window-9"]);
});
