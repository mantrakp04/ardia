import assert from "node:assert/strict";
import { test } from "node:test";
const { startKeyboardFollows } = await import("./keyboardFollows.ts");

const windowOf = (profileId, active) => ({ profileId, activeTabIds: { [profileId]: active } });

function fakeStore(windows) {
  let state = { windows };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    set(windows) {
      const prev = state;
      state = { windows };
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
