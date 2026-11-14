import assert from "node:assert/strict";
import { test } from "node:test";
const { startKeyboardFollows } = await import("./keyboardFollows.ts");

const windowOf = (profileId, active) => ({ profileId, activeTabIds: { [profileId]: active } });

function fakeStore(windows, peeks = {}) {
  let state = { windows, peeks };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    set(windows, peeks = state.peeks) {
      const prev = state;
      state = { windows, peeks };
      for (const listener of listeners) listener(state, prev);
    },
  };
}

test("the keyboard is asked to follow a window's shown tab only when that tab changes", () => {
  const followed = [];
  const store = fakeStore({ w1: windowOf("p", "a"), w2: windowOf("p", "x") });
  const stop = startKeyboardFollows((tabId) => followed.push(tabId), store);
  store.set({ w1: windowOf("p", "b"), w2: windowOf("p", "x") });
  store.set({ w1: windowOf("p", "b"), w2: windowOf("p", "x") });
  store.set({ w1: windowOf("q", "b"), w2: windowOf("p", "x") });
  store.set({ w1: windowOf("p", "b"), w2: windowOf("p", "x"), w3: windowOf("p", "n") });
  assert.deepEqual(followed, ["b", "n"], "a tab switch and a new window's tab; not an unchanged store, nor a profile switch landing on the same tab");
  stop();
});

test("on a platform without the follow call nothing subscribes", () => {
  const store = fakeStore({});
  let subscribed = false;
  store.subscribe = () => ((subscribed = true), () => {});
  startKeyboardFollows(null, store)();
  assert.equal(subscribed, false);
});

test("the keyboard is asked to follow a Peek's page when the user opens one, as the Mac's Peek focuses its page", () => {
  const followed = [];
  const windows = { w1: windowOf("p", "a") };
  const store = fakeStore(windows);
  const stop = startKeyboardFollows((tabId) => followed.push(tabId), store);
  store.set(windows, { w1: { tabId: "peek1", sourceId: "a" } });
  store.set(windows, { w1: { tabId: "peek1", sourceId: "a" } });
  store.set(windows, {});
  store.set(windows, { w1: { tabId: "peek2", sourceId: "a" } });
  assert.deepEqual(followed, ["peek1", "peek2"], "each new Peek once; closing it asks nothing here (the source page refocuses on close)");
  stop();
});
