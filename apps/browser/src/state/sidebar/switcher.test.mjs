import assert from "node:assert/strict";
import { mock, test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { sidebarUi } = await import("./sidebarUi.ts");
const { switcherStep, commitSwitcher, cancelSwitcher } = await import("./switcher.ts");

const S = () => useBrowser.getState();

mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: Date.now() });

function windowWith(...names) {
  S().hydrate({});
  S().updateSettings({ newTabPosition: "bottom" });
  const w = S().createWindow({ url: `https://${names[0]}.com/` });
  const ids = [model.viewTabIds(S(), w)[0], ...names.slice(1).map((n) => S().newTab(w, { url: `https://${n}.com/`, background: true }))];
  const now = Date.now();
  ids.forEach((id, i) => S().updateTab(id, { lastActiveAt: now - i * 1000 }));
  mock.timers.tick(1000);
  S().activate(ids[0]);
  return [w, ...ids];
}

test("⌃Tab opens on the previous open tab and a release switches to it", () => {
  const [w, a, b] = windowWith("a", "b");
  switcherStep(w, false);
  assert.deepEqual(sidebarUi().switcher.ids, [a, b]);
  commitSwitcher();
  assert.equal(model.activeTabId(S(), w), b);
});

test("a pinned tab that is closed while the switcher is up is not reopened by the release", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  S().pinTabs([b], true);
  switcherStep(w, false);
  assert.deepEqual(sidebarUi().switcher.ids, [a, b, c]);
  S().closeTab(b);
  assert.equal(S().tabs[b].page.kind, "asleep");
  commitSwitcher();
  assert.equal(sidebarUi().switcher, null);
  assert.equal(S().tabs[b].page.kind, "asleep");
  assert.equal(model.activeTabId(S(), w), a);
});

test("a click on a row whose tab lost its page meanwhile does not wake it either", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  S().pinTabs([c], true);
  switcherStep(w, false);
  S().closeTab(c);
  commitSwitcher(2);
  assert.equal(S().tabs[c].page.kind, "asleep");
  assert.equal(model.activeTabId(S(), w), a);
  cancelSwitcher();
});

test("with only one open tab ⌃Tab does nothing, whatever closed tabs the window has", () => {
  const [w, a, b] = windowWith("a", "b");
  S().pinTabs([b], true);
  S().closeTab(b);
  switcherStep(w, false);
  assert.equal(sidebarUi().switcher, null);
  assert.equal(model.activeTabId(S(), w), a);
});

test("a row whose tab moved to another window while the switcher was up leaves that window's tab alone", () => {
  const [w, a, b, c] = windowWith("a", "b", "c");
  const other = S().createWindow({ url: "https://other.com/" });
  switcherStep(w, false);
  assert.deepEqual(sidebarUi().switcher.ids, [a, b, c]);
  S().moveTabsToWindow([b, c], other);
  assert.equal(S().tabs[b].windowId, other);
  const shown = model.activeTabId(S(), other);
  assert.notEqual(shown, b);
  commitSwitcher();
  assert.equal(sidebarUi().switcher, null);
  assert.equal(model.activeTabId(S(), other), shown);
  assert.equal(model.activeTabId(S(), w), a);
});
