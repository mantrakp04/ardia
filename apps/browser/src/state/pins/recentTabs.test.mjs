import assert from "node:assert/strict";
import { mock, test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { ASLEEP, IDLE } = await import("../tabs/pageSession.ts");
const { recentTabIds } = await import("./tabCleanup.ts");

const S = () => useBrowser.getState();
const HOUR = 3_600_000;

mock.timers.enable({ apis: ["Date"], now: Date.now() });

const open = (id) => {
  mock.timers.tick(1000);
  S().activate(id);
};

function windowWith(...names) {
  S().hydrate({});
  S().updateSettings({ newTabPosition: "bottom" });
  const w = S().createWindow({ url: `https://${names[0]}.com/` });
  const ids = [model.viewTabIds(S(), w)[0], ...names.slice(1).map((n) => S().newTab(w, { url: `https://${n}.com/`, background: true }))];
  const now = Date.now();
  ids.forEach((id, i) => S().updateTab(id, { lastActiveAt: now - i * 1000 }));
  open(ids[0]);
  return [w, ...ids];
}

test("every open tab is listed, the current one first and the rest by last use", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  assert.deepEqual(recentTabIds(S(), w), [a, b, c]);
  open(c);
  assert.deepEqual(recentTabIds(S(), w), [c, a, b]);
});

test("a pinned tab closed with ⌘W stays out of ⌃Tab until it is opened again", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  S().pinTabs([b], true);
  S().closeTab(b);
  assert.equal(S().tabs[b].page.kind, "asleep");
  assert.deepEqual(recentTabIds(S(), w), [a, c]);
  open(b);
  assert.deepEqual(recentTabIds(S(), w), [b, a, c]);
  open(a);
  assert.deepEqual(recentTabIds(S(), w), [a, b, c]);
});

test("a tab that was never opened or is restored but not loaded stays out of ⌃Tab until its page loads", () => {
  const [w, a, b, c, d] = windowWith("a", "b", "c", "d");
  S().updateTab(b, { page: IDLE });
  S().updateTab(c, { page: ASLEEP });
  assert.deepEqual(recentTabIds(S(), w), [a, d]);
  open(b);
  assert.deepEqual(recentTabIds(S(), w), [b, a, d]);
});

test("the current tab stays in the list even when it has no page, so the first row is always where you are", () => {
  const [w, a, b] = windowWith("a", "b");
  S().updateTab(a, { page: IDLE });
  assert.equal(model.activeTabId(S(), w), a);
  assert.deepEqual(recentTabIds(S(), w), [a, b]);
});

test("closing the current tab promotes an older tab, which still leads the list so ⌃Tab's first step leaves it", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  open(c);
  open(a);
  open(b);
  S().closeTab(b);
  assert.equal(model.activeTabId(S(), w), c);
  assert.deepEqual(recentTabIds(S(), w), [c, a]);
});

test("the current tab leads and is never dropped as stale, loaded or not, even when it was last used longest ago", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  const now = Date.now();
  S().updateTab(a, { lastActiveAt: now - 20 * HOUR });
  S().updateTab(b, { lastActiveAt: now - 1000 });
  S().updateTab(c, { lastActiveAt: now - 2000 });
  assert.deepEqual(recentTabIds(S(), w, now, 10 * HOUR), [a, b, c]);
  S().updateTab(a, { page: IDLE });
  assert.deepEqual(recentTabIds(S(), w, now, 10 * HOUR), [a, b, c]);
});

test("a current tab with no page is the first row, then the latest other tab always stays and older ones still drop out", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  const now = Date.now();
  S().updateTab(a, { page: IDLE, lastActiveAt: now - 40 * HOUR });
  S().updateTab(b, { lastActiveAt: now - 20 * HOUR });
  S().updateTab(c, { lastActiveAt: now - 30 * HOUR });
  assert.deepEqual(recentTabIds(S(), w, now, 10 * HOUR), [a, b]);
});

test("a blank new tab is listed: it is open on the new-tab page", () => {
  const [w, a, b] = windowWith("a", "b");
  const blank = S().newTab(w, { background: true });
  S().updateTab(blank, { lastActiveAt: Date.now() - 5000 });
  assert.deepEqual(recentTabIds(S(), w), [a, b, blank]);
});

test("a pin whose page is open in another window stays listed; once nothing holds the page it does not", () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  const other = S().newTab(a, { url: "https://other.com" });
  S().pinTabs([mail], true);
  open(mail);
  const b = S().createWindow({ url: "https://b.com" });
  const copy = model.viewTabIds(S(), b).find((id) => !!S().tabs[id].pin);
  assert.ok(copy, "the pin is mirrored into the second window");
  assert.equal(S().tabs[copy].page.kind, "asleep");
  assert.ok(recentTabIds(S(), b).includes(copy), "the page is open in the first window, so selecting the copy only moves it");
  open(other);
  S().closeTab(mail);
  assert.equal(S().tabs[mail].page.kind, "asleep");
  assert.equal(recentTabIds(S(), b).includes(copy), false, "nothing holds the page any more");
  assert.equal(recentTabIds(S(), a).includes(mail), false);
});

test("the top-two guard counts open tabs only, and older open tabs still drop out after the clean-up time", () => {
  const [w, a, b, c, d] = windowWith("a", "b", "c", "d");
  const now = Date.now();
  S().updateTab(b, { page: IDLE, lastActiveAt: now - 1000 });
  S().updateTab(c, { lastActiveAt: now - 20 * HOUR });
  S().updateTab(d, { lastActiveAt: now - 30 * HOUR });
  assert.deepEqual(recentTabIds(S(), w, now, 10 * HOUR), [a, c]);
  assert.deepEqual(recentTabIds(S(), w, now, 25 * HOUR), [a, c]);
  assert.deepEqual(recentTabIds(S(), w, now, 40 * HOUR), [a, c, d]);
});

test("closed pinned tiles and rows, whenever they were last used, stay out of ⌃Tab", () => {
  const [w, a, b, c, d] = windowWith("a", "b", "c", "d");
  S().pinTabs([b], true);
  S().pinTabs([c], true, true);
  S().closeTab(b);
  S().closeTab(c);
  assert.equal(S().tabs[b].page.kind, "asleep");
  assert.equal(S().tabs[c].page.kind, "asleep");
  assert.deepEqual(recentTabIds(S(), w), [a, d]);
});
