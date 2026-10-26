import assert from "node:assert/strict";
import { test } from "node:test";

const { useBrowser } = await import("../../state/browser/store.ts");
const { DEFAULT_SETTINGS } = await import("../../state/settings/settings.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../../state/session/persist.ts");
const { settingsAdapter } = await import("../../state/sync/settingsAdapter.ts");
const stub = await import("../../test-native/index.ts");
const S = () => useBrowser.getState();

test("the page frame is on for new and existing settings", () => {
  assert.equal(DEFAULT_SETTINGS.showPageFrame, true);
  S().hydrate({});
  assert.equal(S().settings.showPageFrame, true);
  S().hydrate({ settings: { addressBar: "sidebar", appearance: "dark" } });
  assert.equal(S().settings.showPageFrame, true);
  assert.equal(S().settings.addressBar, "sidebar");
});

test("the page frame choice is global, saved both ways, and never changes a tab's navigation", () => {
  stub.docs.clear();
  const stop = startPersistence();
  try {
    const a = S().createWindow({ url: "https://example.com/" });
    const profile = S().createProfile({ name: "Work" });
    const b = S().createWindow({ profileId: profile, url: "https://example.org/" });
    const before = S().tabs;
    S().updateSettings({ showPageFrame: false });
    assert.equal(S().settings.showPageFrame, false);
    assert.equal(S().tabs, before);
    assert.ok(S().settings.chosen.includes("showPageFrame"));
    flushPersistence();
    assert.equal(JSON.parse(stub.docs.get("session.json")).settings.showPageFrame, false);
    S().hydrate(loadSession());
    assert.equal(S().settings.showPageFrame, false);
    assert.ok(S().windows[a] && S().windows[b]);
    const c = S().createWindow({ url: "https://example.net/" });
    assert.equal(S().settings.showPageFrame, false);
    assert.ok(S().windows[c]);
    const tabs = S().tabs;
    S().updateSettings({ showPageFrame: true });
    assert.equal(S().tabs, tabs);
    flushPersistence();
    S().hydrate(loadSession());
    assert.equal(S().settings.showPageFrame, true);
  } finally {
    stop();
  }
});

test("page-frame insets release the real content area while keeping the top tab strip's space", async () => {
  const { pageFrameInsets } = await import("./pageFrame.ts");
  assert.deepEqual(pageFrameInsets(true), { top: 6, right: 7, bottom: 7, left: 7 });
  assert.deepEqual(pageFrameInsets(false), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(pageFrameInsets(true, 42, 6), { top: 42, right: 6, bottom: 6, left: 6 });
  assert.deepEqual(pageFrameInsets(false, 42, 6), { top: 42, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(pageFrameInsets(false, 0, 6), pageFrameInsets(false));
});

test("the existing settings adapter syncs an explicit frame choice and leaves the default unsent", () => {
  S().hydrate({});
  assert.equal(settingsAdapter.extract(() => undefined).values.has("set:showPageFrame"), false);
  S().updateSettings({ showPageFrame: false });
  assert.deepEqual(settingsAdapter.extract(() => undefined).values.get("set:showPageFrame"), { v: false });
  S().hydrate({});
  settingsAdapter.apply(new Map([["set:showPageFrame", { v: false }]]), ["set:showPageFrame"]);
  assert.equal(S().settings.showPageFrame, false);
  settingsAdapter.apply(new Map([["set:showPageFrame", { v: true }]]), ["set:showPageFrame"]);
  assert.equal(S().settings.showPageFrame, true);
});

test("frame clipping is restored on enable, stays off in page fullscreen, and preserves Little Ardia", async () => {
  const { pageFrameRadius } = await import("./pageFrame.ts");
  assert.equal(pageFrameRadius(true, false, false), 10);
  assert.equal(pageFrameRadius(false, false, false), 0);
  assert.equal(pageFrameRadius(true, false, false), 10);
  for (const frame of [false, true]) {
    assert.equal(pageFrameRadius(frame, true, false), 0);
    assert.equal(pageFrameRadius(frame, false, true), 10);
    assert.equal(pageFrameRadius(frame, true, true), 0);
  }
});
