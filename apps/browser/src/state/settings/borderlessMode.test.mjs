import assert from "node:assert/strict";
import { test } from "node:test";
import { pageFrameInset, pageFrameOf } from "../../lib/windowLayout.ts";
import { DEFAULT_SETTINGS, parseSettings } from "./settings.ts";
import { useBrowser } from "../browser/store.ts";
import { flushPersistence, loadSession, startPersistence } from "../session/persist.ts";
import { settingsAdapter, SYNCED_SETTINGS } from "../sync/settingsAdapter.ts";
import { openingLightsCenter } from "../windows/layout.ts";
import { docs } from "../../test-native/index.ts";
import { confirmAnswer, QUESTIONS, resolveDraft, setOnboardingDraft, useOnboarding } from "../onboarding/onboarding.ts";

test("old sessions keep their frame and malformed borderless values stay off", () => {
  assert.equal(DEFAULT_SETTINGS.borderlessMode, false);
  for (const value of [undefined, null, "true", 1, {}]) {
    const settings = parseSettings({ pageFrame: 6, borderlessMode: value });
    assert.equal(settings.borderlessMode, false);
    assert.equal(pageFrameInset(settings), 6);
  }
});

test("borderless pages have no inset or corner cutouts, while peek and split controls remain usable", () => {
  for (let inset = 0; inset <= 12; inset++) {
    const settings = parseSettings({ pageFrame: inset, borderlessMode: true });
    const frame = pageFrameOf(pageFrameInset(settings), 19, 16);
    assert.equal(frame.inset, 0);
    assert.equal(frame.radius, 0);
    assert.equal(frame.splitGap, 2);
    assert.deepEqual(frame.peek, { left: 4, top: 4, bottom: 4, radius: 15 });
    assert.equal(pageFrameInset({ ...settings, borderlessMode: false }), inset);
  }
});

test("the mode survives a relaunch and turning it off restores the chosen thickness", () => {
  docs.clear();
  useBrowser.getState().hydrate({ settings: { pageFrame: 6 } });
  const stop = startPersistence();
  try {
    useBrowser.getState().updateSettings({ pageFrame: 6, borderlessMode: true });
    flushPersistence();
  } finally {
    stop();
  }
  useBrowser.getState().hydrate(loadSession());
  assert.equal(useBrowser.getState().settings.borderlessMode, true);
  assert.equal(pageFrameInset(useBrowser.getState().settings), 0);
  useBrowser.getState().updateSettings({ borderlessMode: false });
  assert.equal(pageFrameInset(useBrowser.getState().settings), 6);
});

test("sync carries the mode without replacing the saved frame thickness", () => {
  useBrowser.getState().hydrate({ settings: { pageFrame: 7 } });
  assert.ok(SYNCED_SETTINGS.includes("borderlessMode"));
  settingsAdapter.apply(new Map([["set:borderlessMode", { v: true }]]), ["set:borderlessMode"]);
  assert.equal(pageFrameInset(useBrowser.getState().settings), 0);
  assert.equal(useBrowser.getState().settings.pageFrame, 7);
});

test("new windows place their traffic lights on the borderless toolbar immediately", () => {
  useBrowser.getState().hydrate({ settings: { pageFrame: 9, borderlessMode: true, addressBar: "toolbar" } });
  const id = useBrowser.getState().createWindow();
  assert.deepEqual(openingLightsCenter(useBrowser.getState(), id), [25, 21]);
  useBrowser.getState().updateSettings({ borderlessMode: false });
  assert.deepEqual(openingLightsCenter(useBrowser.getState(), id), [25, 30]);
});

test("onboarding keeps the mode until a frame choice replaces it, then confirms both settings together", () => {
  useBrowser.getState().hydrate({ settings: { pageFrame: 6, borderlessMode: true } });
  useOnboarding.setState({ step: "details", sub: QUESTIONS.details.findIndex((q) => q.id === "frame"), draft: {}, baseline: {}, windowId: null });
  const keys = QUESTIONS.details.find((q) => q.id === "frame").keys;
  const unchanged = resolveDraft(keys, {}, "fresh", useBrowser.getState().settings, []);
  assert.deepEqual(unchanged, { pageFrame: 6, borderlessMode: true });
  assert.equal(pageFrameInset(unchanged), 0);
  setOnboardingDraft({ pageFrame: 4, borderlessMode: false });
  const chosen = resolveDraft(keys, useOnboarding.getState().draft, "fresh", useBrowser.getState().settings, []);
  assert.equal(pageFrameInset(chosen), 4);
  confirmAnswer("frame", chosen, ["Page frame 4 pt"]);
  assert.equal(useBrowser.getState().settings.borderlessMode, false);
  assert.equal(useBrowser.getState().settings.pageFrame, 4);
});
