import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { cleanUpCandidates, nextCleanUpAt } = await import("./tabCleanup.ts");
const { nextAutoCleanUpAt, startAutoCleanUp, stopAutoCleanUp } = await import("./autoCleanUp.ts");

const S = () => useBrowser.getState();
const MIN = 60_000;

function windowWith(...urls) {
  S().hydrate({});
  S().updateSettings({ newTabPosition: "bottom" });
  const w = S().createWindow({ url: `https://${urls[0]}.com/` });
  const ids = [model.viewTabIds(S(), w)[0], ...urls.slice(1).map((u) => S().newTab(w, { url: `https://${u}.com/`, background: true }))];
  S().activate(ids[0]);
  return [w, ...ids];
}

test("the next clean-up is due when the longest-idle tab that can go reaches the time; pinned and selected tabs never count", () => {
  const [w, a, b, c, d] = windowWith("a", "b", "c", "d");
  const now = Date.now();
  S().updateTab(a, { lastActiveAt: now - 50 * MIN });
  S().updateTab(b, { lastActiveAt: now - 20 * MIN });
  S().updateTab(c, { lastActiveAt: now - 5 * MIN });
  S().updateTab(d, { lastActiveAt: now - 90 * MIN });
  S().pinTabs([d], true);
  assert.equal(nextCleanUpAt(S(), w, 30 * MIN), now + 10 * MIN);
  assert.deepEqual(cleanUpCandidates(S(), w, 30 * MIN, now), []);
  assert.deepEqual(cleanUpCandidates(S(), w, 30 * MIN, now + 10 * MIN), [b]);
});

test("automatic clean-up is off without a time, and otherwise checks again within the time or half an hour", () => {
  const [w, , b] = windowWith("a", "b");
  const now = Date.now();
  S().updateSettings({ cleanUpInactiveTabsAfterMinutes: null });
  assert.equal(nextAutoCleanUpAt(S(), now), null);
  S().updateSettings({ cleanUpInactiveTabsAfterMinutes: 30 * 24 * 60 });
  assert.equal(nextAutoCleanUpAt(S(), now), now + 30 * MIN);
  S().updateSettings({ cleanUpInactiveTabsAfterMinutes: 5 });
  S().updateTab(b, { lastActiveAt: now });
  assert.equal(nextAutoCleanUpAt(S(), now), now + 5 * MIN);
  S().updateTab(b, { lastActiveAt: now - 3 * MIN });
  assert.equal(nextAutoCleanUpAt(S(), now), now + 2 * MIN);
  assert.ok(S().windows[w]);
});

test("automatic clean-up wakes when the next tab is due and honours minutes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    const [w, a, b, c] = windowWith("a", "b", "c");
    S().updateTab(b, { lastActiveAt: Date.now() - 29 * MIN });
    S().updateTab(c, { lastActiveAt: Date.now() - 10 * MIN });
    startAutoCleanUp();
    S().updateSettings({ cleanUpInactiveTabsAfterMinutes: 30 });
    t.mock.timers.tick(59_000);
    assert.ok(S().tabs[b], "not idle for 30 minutes yet");
    t.mock.timers.tick(2_000);
    assert.ok(!S().tabs[b], "closed once it reached 30 minutes");
    assert.ok(S().tabs[c] && S().tabs[a]);
    t.mock.timers.tick(19 * MIN);
    assert.ok(!S().tabs[c]);
    assert.ok(S().tabs[a], "the selected tab stays");
    assert.deepEqual(S().cleanedTabs.slice(-2).map((e) => e.tab.url), ["https://b.com/", "https://c.com/"]);
    assert.equal(model.viewTabIds(S(), w).length, 1);
  } finally {
    stopAutoCleanUp();
  }
});

test("a tab you were on counts as used until you leave it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    const [w, a, b] = windowWith("a", "b");
    S().updateTab(a, { lastActiveAt: Date.now() - 2 * 60 * MIN });
    startAutoCleanUp();
    S().updateSettings({ cleanUpInactiveTabsAfterMinutes: 30 });
    t.mock.timers.tick(MIN);
    S().activate(b);
    t.mock.timers.tick(29 * MIN);
    assert.ok(S().tabs[a], "left 29 minutes ago");
    assert.deepEqual(cleanUpCandidates(S(), w, 30 * MIN), []);
    t.mock.timers.tick(MIN + 1000);
    assert.ok(!S().tabs[a], "left 30 minutes ago");
  } finally {
    stopAutoCleanUp();
  }
});

test("tabs brought back by Restore All or a reopened window count as used when they come back, and keep their last-use time", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    const [w, , b, c] = windowWith("a", "b", "c");
    const usedAt = Date.now() - 2 * 60 * MIN;
    S().updateTab(b, { lastActiveAt: usedAt });
    startAutoCleanUp();
    S().updateSettings({ cleanUpInactiveTabsAfterMinutes: 30 });
    t.mock.timers.tick(1000);
    assert.ok(!S().tabs[b], "cleaned up");
    S().restoreCleaned();
    const back = model.viewTabIds(S(), w).find((id) => S().tabs[id].url === "https://b.com/");
    assert.equal(S().tabs[back].lastActiveAt, usedAt);
    assert.deepEqual(cleanUpCandidates(S(), w, 30 * MIN), [], "just restored");
    S().updateTab(c, { lastActiveAt: usedAt });
    S().createWindow();
    S().closeWindow(w);
    S().reopenClosedWindow();
    const reopened = S().ui.focusedWindowId;
    const old = model.viewTabIds(S(), reopened).find((id) => S().tabs[id].url === "https://c.com/");
    assert.equal(S().tabs[old].lastActiveAt, usedAt);
    assert.ok(!cleanUpCandidates(S(), reopened, 30 * MIN).includes(old), "just reopened");
    t.mock.timers.tick(29 * MIN);
    assert.ok(S().tabs[old], "reopened 29 minutes ago");
    t.mock.timers.tick(2 * MIN);
    assert.ok(!S().tabs[old], "reopened 31 minutes ago and not used since");
  } finally {
    stopAutoCleanUp();
  }
});

test("with tabs shared across windows, a restored tab and its copy in the other window both count as used when it came back, even after the source window closes", () => {
  const [w, , b] = windowWith("a", "b", "c", "d");
  S().updateSettings({ shareTabsAcrossWindows: true });
  S().createWindow();
  const usedAt = Date.now() - 2 * 60 * MIN;
  for (const t of Object.values(S().tabs)) if (t.url === "https://b.com/") S().updateTab(t.id, { lastActiveAt: usedAt });
  S().cleanUpTabs(w, { inactiveForMs: 30 * MIN });
  assert.ok(!S().tabs[b], "cleaned up");
  S().restoreCleaned();
  const copies = Object.values(S().tabs).filter((t) => t.url === "https://b.com/");
  assert.equal(copies.length, 2, "one in each window");
  for (const id of S().windowOrder) S().cleanUpTabs(id, { inactiveForMs: 30 * MIN });
  assert.equal(Object.values(S().tabs).filter((t) => t.url === "https://b.com/").length, 2);
  S().closeWindow(w);
  for (const id of S().windowOrder) S().cleanUpTabs(id, { inactiveForMs: 30 * MIN });
  assert.equal(Object.values(S().tabs).filter((t) => t.url === "https://b.com/").length, 1, "the copy stays after its source window closes");
});

test("with tabs shared across windows, clean-up waits for the latest restore of any copy", () => {
  const [w, , b] = windowWith("a", "b", "c", "d");
  S().updateSettings({ shareTabsAcrossWindows: true });
  const other = S().createWindow();
  const usedAt = Date.now() - 2 * 60 * MIN;
  const copies = () => Object.values(S().tabs).filter((t) => t.url === "https://b.com/");
  for (const t of copies()) S().updateTab(t.id, { lastActiveAt: usedAt, restoredAt: t.windowId === w ? usedAt : Date.now() });
  assert.equal(copies().length, 2);
  assert.deepEqual(cleanUpCandidates(S(), w, 30 * MIN).filter((id) => id === b), []);
  S().cleanUpTabs(w, { inactiveForMs: 30 * MIN });
  assert.equal(copies().length, 2, "the copy restored just now keeps both");
  assert.ok(S().windows[other]);
});

test("Restore All on a page that's open again keeps the restored tab and cleans up the other copy", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const [w, , b] = windowWith("a", "b", "c", "d");
  S().updateTab(b, { lastActiveAt: Date.now() - 2 * 60 * MIN });
  S().cleanUpTabs(w, { inactiveForMs: 30 * MIN });
  assert.ok(!S().tabs[b], "cleaned up");
  t.mock.timers.tick(MIN);
  const again = S().newTab(w, { url: "https://b.com/", background: true });
  t.mock.timers.tick(MIN);
  S().restoreCleaned();
  const restored = model.viewTabIds(S(), w).find((id) => id !== again && S().tabs[id].url === "https://b.com/");
  assert.deepEqual(cleanUpCandidates(S(), w, 30 * MIN), [again]);
  S().cleanUpTabs(w, { inactiveForMs: 30 * MIN });
  assert.ok(!S().tabs[again], "the other copy is cleaned up");
  assert.ok(S().tabs[restored], "the restored tab stays");
});

test("switching the setting off stops the timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    const [, , b] = windowWith("a", "b");
    S().updateTab(b, { lastActiveAt: Date.now() - 29 * MIN });
    startAutoCleanUp();
    S().updateSettings({ cleanUpInactiveTabsAfterMinutes: 30 });
    S().updateSettings({ cleanUpInactiveTabsAfterMinutes: null });
    t.mock.timers.tick(60 * MIN);
    assert.ok(S().tabs[b]);
  } finally {
    stopAutoCleanUp();
  }
});
