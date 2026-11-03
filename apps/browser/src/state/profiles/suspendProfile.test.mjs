import assert from "node:assert/strict";
import { test } from "node:test";
import { suspendProfilePages } from "./suspendProfile.ts";

function fixture() {
  const page = { kind: "loaded", nav: { url: "https://example.com", seq: 9001 } };
  const state = {
    settings: { memorySaver: true, unloadProfilesAfter: "5m" },
    profiles: { default: {}, work: {}, alias: { dataId: "work" } },
    windows: { first: { profileId: "default" } },
    tabs: { tab: { id: "tab", profileId: "work", url: "https://example.com", page } },
    updateTab(id, patch) { this.tabs[id] = { ...this.tabs[id], ...patch }; },
  };
  const calls = [];
  const handles = new Map([["tab", { discard: async (options) => (calls.push(options), "unloaded") }]]);
  return { state, calls, port: { state: () => state, handles } };
}

test("unloading keeps logical tabs and uses existing lazy page restoration", async () => {
  const { state, calls, port } = fixture();
  assert.equal(await suspendProfilePages("work", port), true);
  assert.deepEqual(calls, [{ unload: true }]);
  assert.equal(state.tabs.tab.page.kind, "asleep");
  assert.equal(state.tabs.tab.url, "https://example.com");
});

test("any selected window, including a profile alias, protects the profile", async () => {
  const { state, calls, port } = fixture();
  state.windows.second = { profileId: "alias" };
  assert.equal(await suspendProfilePages("work", port), false);
  assert.deepEqual(calls, []);
});

test("disabled Memory Saver and unmounted retained pages prevent release", async () => {
  const { state, calls, port } = fixture();
  state.settings.memorySaver = false;
  assert.equal(await suspendProfilePages("work", port), false);
  state.settings.memorySaver = true;
  port.handles.clear();
  assert.equal(await suspendProfilePages("work", port), false);
  assert.deepEqual(calls, []);
});

test("a refused unload preserves the page and prevents profile release", async () => {
  const { state, port } = fixture();
  port.handles.set("tab", { discard: async () => "refused" });
  assert.equal(await suspendProfilePages("work", port), false);
  assert.equal(state.tabs.tab.page.kind, "loaded");
});

test("selection while unload is pending wakes the page rather than releasing its profile", async () => {
  const { state, port } = fixture();
  port.handles.set("tab", { discard: async () => {
    state.windows.second = { profileId: "work" };
    return "unloaded";
  } });
  assert.equal(await suspendProfilePages("work", port), false);
  assert.equal(state.tabs.tab.page.kind, "loaded");
  assert.notEqual(state.tabs.tab.page.nav.seq, 9001);
});


test("a navigation while unload is pending is not overwritten", async () => {
  const { state, port } = fixture();
  port.handles.set("tab", { discard: async () => {
    state.updateTab("tab", { url: "https://changed.example", page: { kind: "loaded", nav: { url: "https://changed.example", seq: 9002 } } });
    return "unloaded";
  } });
  assert.equal(await suspendProfilePages("work", port), false);
  assert.equal(state.tabs.tab.url, "https://changed.example");
  assert.equal(state.tabs.tab.page.kind, "loaded");
  assert.equal(state.tabs.tab.page.nav.seq, 9002);
});

test("the Off choice prevents native page unloading", async () => {
  const { state, calls, port } = fixture();
  state.settings.unloadProfilesAfter = "never";
  assert.equal(await suspendProfilePages("work", port), false);
  assert.deepEqual(calls, []);
});


test("changing the timeout during unloading stops the profile release", async () => {
  const { state, port } = fixture();
  port.handles.set("tab", { discard: async () => {
    state.settings = { ...state.settings, unloadProfilesAfter: "2h" };
    return "unloaded";
  } });
  assert.equal(await suspendProfilePages("work", port), false);
  assert.equal(state.tabs.tab.page.kind, "asleep");
});
