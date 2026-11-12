import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId, IDLE_LIVE } = await import("../browser/model.ts");
const { canGoBack, goBack } = await import("./navigation.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const live = (id) => S().live[id] ?? IDLE_LIVE;
const shown = (w) => activeTabId(S(), w);

function windowWith(host) {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom" });
  const w = S().createWindow({ url: `https://${host}.com/` });
  return { w, a: S().windows[w].tabIds[0] };
}

test("back on a tab opened in front from a link, with no history of its own, closes it and shows the opener", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  assert.equal(shown(w), b);
  assert.equal(live(b).canGoBack, false);
  assert.equal(canGoBack(b, live(b)), true, "back is offered even though the page cannot go back");
  const closed = S().closedTabs.length;
  goBack(b);
  assert.equal(S().tabs[b], undefined, "the tab closed");
  assert.equal(shown(w), a, "the opener is shown");
  assert.equal(S().closedTabs.length, closed + 1, "the closed tab is recorded, so reopen brings it back");
  assert.equal(S().closedTabs.at(-1).tab.url, "https://b.com/");
});

test("back on a tab opened behind from a link, then switched to, closes it and shows the opener", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: true });
  assert.equal(shown(w), a);
  S().activate(b);
  assert.equal(canGoBack(b, live(b)), true);
  goBack(b);
  assert.equal(S().tabs[b], undefined);
  assert.equal(shown(w), a);
});

test("back on a tab with no opener and no history does nothing", () => {
  const { w, a } = windowWith("a");
  assert.equal(canGoBack(a, live(a)), false);
  goBack(a);
  assert.ok(S().tabs[a]);
  assert.equal(shown(w), a);
});

test("back on a tab a link opened goes back in the page when the page has history", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  S().updateTab(b, {}, { canGoBack: true });
  assert.equal(live(b).canGoBack, true);
  goBack(b);
  assert.ok(S().tabs[b], "the tab stays: the page went back instead");
  assert.equal(shown(w), b);
});

test("back does not close a pinned tab, even one a link opened", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  S().pinTabs([b], true);
  assert.equal(canGoBack(b, live(b)), false);
  goBack(b);
  assert.ok(S().tabs[b], "the pinned tab stays");
});

test("back does nothing once the opener is gone", () => {
  const { w, a } = windowWith("a");
  const b = S().newTab(w, { url: "https://b.com/", openerId: a, background: false });
  S().closeTab(a);
  assert.ok(S().tabs[b]);
  assert.equal(canGoBack(b, live(b)), false);
  goBack(b);
  assert.ok(S().tabs[b], "the tab stays: there is no opener to go back to");
  assert.equal(shown(w), b);
});
